package app

import (
	corechat "Syne/core/chat"
	corecrypto "Syne/core/crypto"
	"Syne/core/history"
	p2ptransport "Syne/core/transport/p2p"
	"context"
	"crypto/ecdh"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"

	"github.com/libp2p/go-libp2p/core/peer"
)

const (
	defaultInviteTTL     = 15 * time.Minute
	directSendTimeout    = 2 * time.Second
	relaySendTimeout     = 8 * time.Second
	autosaveInterval     = 10 * time.Second
	mailboxPollInterval  = 4 * time.Second
	whoamiRefreshMinimum = 20 * time.Second
)

type Config struct {
	LocalID    string `json:"local_id"`
	Port       int    `json:"port"`
	ServerAddr string `json:"server_addr"`
}

type Snapshot struct {
	LocalID     string                 `json:"local_id"`
	Port        int                    `json:"port"`
	Contacts    []corechat.Contact     `json:"contacts"`
	Blocked     []corechat.BlockedPeer `json:"blocked"`
	Neighbors   []PeerPresence         `json:"neighbors"`
	OnlineUsers []OnlineUser           `json:"online_users"`
	Chats       []ChatSummary          `json:"chats"`
}

type UserSession struct {
	UserID             string
	SessionID          string
	MasterKey          []byte
	IdentityPrivateKey []byte
	IdentityPublicKey  []byte
	FName              string
	SName              string
}

type PeerPresence struct {
	PeerID   string `json:"peer_id"`
	UserID   string `json:"user_id,omitempty"`
	Name     string `json:"name"`
	Addr     string `json:"addr"`
	LastSeen int64  `json:"last_seen"`
	Blocked  bool   `json:"blocked"`
}

// OnlineUser — запись из presence-канала study-сервера.
type OnlineUser struct {
	UserID   string `json:"user_id"`
	PeerID   string `json:"peer_id"`
	FName    string `json:"fname"`
	SName    string `json:"sname"`
	Online   bool   `json:"online"`
	LastSeen int64  `json:"last_seen"`
}

type ChatSummary struct {
	ChatID        string `json:"chat_id"`
	PeerID        string `json:"peer_id"`
	PeerUserID    string `json:"peer_user_id,omitempty"`
	Title         string `json:"title"`
	Preview       string `json:"preview"`
	LastTimestamp int64  `json:"last_timestamp"`
	KnownAddr     string `json:"known_addr,omitempty"`
	Online        bool   `json:"online"`
	Blocked       bool   `json:"blocked"`
	UnreadCount   int    `json:"unread_count"`
}

type UIMessage struct {
	MessageID string `json:"message_id,omitempty"`
	ChatID    string `json:"chat_id"`
	TargetID  string `json:"target_id"`
	From      string `json:"from"`
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
	Direction string `json:"direction"`
	Strategy  string `json:"strategy"`
}

type Event struct {
	Type       string                `json:"type"`
	Timestamp  int64                 `json:"timestamp"`
	Peer       *PeerPresence         `json:"peer,omitempty"`
	OnlineUser *OnlineUser           `json:"online_user,omitempty"`
	Chat       *ChatSummary          `json:"chat,omitempty"`
	Message    *UIMessage            `json:"message,omitempty"`
	Contact    *corechat.Contact     `json:"contact,omitempty"`
	Blocked    *corechat.BlockedPeer `json:"blocked,omitempty"`
	Error      string                `json:"error,omitempty"`
}

type InviteCode struct {
	Code      string `json:"code"`
	PeerID    string `json:"peer_id"`
	ExpiresAt int64  `json:"expires_at"`
}

type rateState struct {
	tokens float64
	last   time.Time
}

// vaultBlob — то, что уезжает на сервер (после шифрования master key'ем).
type vaultBlob struct {
	Version int             `json:"version"`
	History json.RawMessage `json:"history"`
	Chat    json.RawMessage `json:"chat"`
}

// permanentError — сообщение никогда не удастся обработать (чужой адресат,
// битая подпись/шифртекст). Такие сообщения из mailbox удаляем, остальные
// оставляем на сервере и пробуем снова.
type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

func permanent(format string, a ...any) error {
	return permanentError{fmt.Errorf(format, a...)}
}

func isPermanent(err error) bool {
	var p permanentError
	return errors.As(err, &p)
}

type Service struct {
	cfg Config

	ctx      context.Context
	cancel   context.CancelFunc
	identity *corecrypto.Identity
	node     *p2ptransport.Node

	// Всё ниже, кроме session*, — состояние ТЕКУЩЕЙ сессии и сбрасывается при выходе.
	stateMu     sync.RWMutex
	neighbors   map[string]PeerPresence
	onlineUsers map[string]OnlineUser
	peerKeys    map[string][]byte // login -> X25519 public key
	peerNames   map[string]string // login -> "Имя Фамилия"
	chatKeys    map[string][]byte // chatID -> ключ чата
	unread      map[string]int
	rateStates  map[string]*rateState
	whoamiAt    map[string]time.Time

	subMu       sync.RWMutex
	subscribers map[chan Event]struct{}

	sessionMu  sync.RWMutex
	session    *UserSession
	sessCancel context.CancelFunc
	sessGen    uint64
	sessWG     sync.WaitGroup

	flushMu  sync.Mutex
	savedVer uint64
}

func New(config Config) (*Service, error) {
	identity, err := corecrypto.LoadOrCreateIdentity()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{
		cfg: Config{
			LocalID:    identity.PeerID,
			Port:       config.Port,
			ServerAddr: config.ServerAddr,
		},
		ctx:         ctx,
		cancel:      cancel,
		identity:    identity,
		neighbors:   make(map[string]PeerPresence),
		onlineUsers: make(map[string]OnlineUser),
		peerKeys:    make(map[string][]byte),
		peerNames:   make(map[string]string),
		chatKeys:    make(map[string][]byte),
		unread:      make(map[string]int),
		rateStates:  make(map[string]*rateState),
		whoamiAt:    make(map[string]time.Time),
		subscribers: make(map[chan Event]struct{}),
	}, nil
}

// ======================= lifecycle =======================

func (s *Service) Start() error {
	node, err := p2ptransport.NewNode(s.ctx, s.identity, s.handlePacket, s.handlePeer)
	if err != nil {
		return err
	}
	s.node = node

	serverAddr := strings.TrimSpace(s.cfg.ServerAddr)
	if serverAddr == "" {
		discoverCtx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
		found, discErr := s.node.DiscoverStudyServer(discoverCtx, 5*time.Second)
		cancel()
		if discErr != nil {
			fmt.Printf("study server auto-discovery: %v\n", discErr)
		} else {
			fmt.Printf("study server auto-discovered at %s\n", found)
			serverAddr = found
			s.cfg.ServerAddr = found
		}
	}
	if serverAddr != "" {
		ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
		welcome, err := s.node.ConnectToServer(ctx, serverAddr)
		cancel()
		if err != nil {
			fmt.Printf("warning: could not connect to study server: %v\n", err)
		} else {
			fmt.Printf("study server connected: server_id=%s server_version=%s timestamp=%d\n",
				welcome.ServerID, welcome.ServerVersion, welcome.Timestamp)
		}
	}
	s.node.SetWhoAmIHandler(s)
	s.node.SetIdentityKeyHandler(s)
	return nil
}

func (s *Service) Stop() {
	_ = s.endSession() // выгрузит данные на сервер
	s.cancel()
	if s.node != nil {
		_ = s.node.Close()
	}
	s.subMu.Lock()
	for ch := range s.subscribers {
		close(ch)
	}
	s.subscribers = map[chan Event]struct{}{}
	s.subMu.Unlock()
}

func (s *Service) Login(login, password string) error {
	result, err := s.node.Login(s.ctx, s.cfg.ServerAddr, login, password)
	if err != nil {
		return err
	}
	return s.beginSession(login, result)
}

func (s *Service) Register(login, fname, sname, password string) error {
	if _, err := s.node.Register(s.ctx, s.cfg.ServerAddr, login, fname, sname, password); err != nil {
		return err
	}
	return s.Login(login, password)
}

func (s *Service) ClaimAccount(login, claimCode, newPassword string) error {
	result, err := s.node.ClaimAccount(s.ctx, s.cfg.ServerAddr, login, claimCode, newPassword)
	if err != nil {
		return err
	}
	return s.beginSession(login, result)
}

func (s *Service) Logout() error {
	return s.endSession()
}

// beginSession: закрывает предыдущую сессию (с выгрузкой её данных), скачивает
// vault нового пользователя и запускает фоновые циклы.
func (s *Service) beginSession(login string, r *p2ptransport.LoginResult) error {
	_ = s.endSession()

	sess := &UserSession{
		UserID:             login,
		SessionID:          r.SessionID,
		MasterKey:          r.MasterKey,
		IdentityPrivateKey: r.IdentityPrivateKey,
		IdentityPublicKey:  r.IdentityPublicKey,
		FName:              r.FName,
		SName:              r.SName,
	}

	if err := s.loadVault(sess); err != nil {
		s.dropServerSession(sess)
		history.Reset()
		corechat.Reset()
		return err
	}

	sessCtx, cancel := context.WithCancel(s.ctx)
	s.sessionMu.Lock()
	s.sessGen++
	gen := s.sessGen
	s.session = sess
	s.sessCancel = cancel
	s.sessionMu.Unlock()

	s.sessWG.Add(2)
	go s.autosaveLoop(sessCtx, sess)
	go s.mailboxLoop(sessCtx, sess)
	go s.startPresence(sessCtx, sess, gen)

	s.emit(Event{Type: "logged_in", Timestamp: time.Now().UnixMilli()})
	return nil
}

// endSession: остановить циклы -> выгрузить vault -> закрыть сессию на
// сервере -> стереть ВСЁ из памяти. После этого на ПК не остаётся ничего.
func (s *Service) endSession() error {
	s.sessionMu.Lock()
	sess := s.session
	cancel := s.sessCancel
	s.session = nil
	s.sessCancel = nil
	s.sessionMu.Unlock()
	if sess == nil {
		return fmt.Errorf("not logged in")
	}

	cancel()
	s.sessWG.Wait()

	var flushErr error
	for attempt := 0; attempt < 3; attempt++ {
		if flushErr = s.flushVault(sess, true); flushErr == nil {
			break
		}
		fmt.Printf("logout: vault upload attempt %d failed: %v\n", attempt+1, flushErr)
		time.Sleep(500 * time.Millisecond)
	}

	s.dropServerSession(sess)
	s.resetSessionState()
	s.emit(Event{Type: "logged_out", Timestamp: time.Now().UnixMilli()})
	if flushErr != nil {
		return fmt.Errorf("history could not be saved to the server: %w", flushErr)
	}
	return nil
}

func (s *Service) dropServerSession(sess *UserSession) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = s.node.SyncLogout(ctx, s.cfg.ServerAddr, sess.SessionID)
}

func (s *Service) resetSessionState() {
	history.Reset()
	corechat.Reset()
	s.stateMu.Lock()
	s.onlineUsers = make(map[string]OnlineUser)
	s.peerKeys = make(map[string][]byte)
	s.peerNames = make(map[string]string)
	s.chatKeys = make(map[string][]byte)
	s.unread = make(map[string]int)
	s.whoamiAt = make(map[string]time.Time)
	for id, n := range s.neighbors {
		n.UserID = ""
		n.Name = id
		s.neighbors[id] = n
	}
	s.stateMu.Unlock()
}

// ======================= vault =======================

func (s *Service) loadVault(sess *UserSession) error {
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()

	data, exists, err := s.node.VaultGet(ctx, s.cfg.ServerAddr, sess.SessionID)
	if err != nil {
		return fmt.Errorf("load data from server: %w", err)
	}

	history.Reset()
	corechat.Reset()
	if exists {
		plain, err := corecrypto.UnwrapKey(data, sess.MasterKey)
		if err != nil {
			// Не перезаписываем чужой/испорченный vault пустым — просто не пускаем.
			return fmt.Errorf("server data cannot be decrypted with this account's key: %w", err)
		}
		var blob vaultBlob
		if err := json.Unmarshal(plain, &blob); err != nil {
			return fmt.Errorf("parse server data: %w", err)
		}
		if len(blob.History) > 0 {
			if err := history.Import(blob.History); err != nil {
				return fmt.Errorf("import history: %w", err)
			}
		}
		if len(blob.Chat) > 0 {
			if err := corechat.Import(blob.Chat); err != nil {
				return fmt.Errorf("import contacts: %w", err)
			}
		}
	}

	s.flushMu.Lock()
	s.savedVer = history.Version() + corechat.Version()
	s.flushMu.Unlock()
	return nil
}

func (s *Service) flushVault(sess *UserSession, force bool) error {
	s.flushMu.Lock()
	defer s.flushMu.Unlock()

	ver := history.Version() + corechat.Version()
	if !force && ver == s.savedVer {
		return nil
	}
	hist, err := history.Export()
	if err != nil {
		return err
	}
	chatData, err := corechat.Export()
	if err != nil {
		return err
	}
	blob, err := json.Marshal(vaultBlob{Version: 1, History: hist, Chat: chatData})
	if err != nil {
		return err
	}
	enc, err := corecrypto.WrapKey(blob, sess.MasterKey)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.node.VaultPut(ctx, s.cfg.ServerAddr, sess.SessionID, enc); err != nil {
		return err
	}
	s.savedVer = ver
	return nil
}

func (s *Service) autosaveLoop(ctx context.Context, sess *UserSession) {
	defer s.sessWG.Done()
	ticker := time.NewTicker(autosaveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.flushVault(sess, false); err != nil {
				fmt.Printf("autosave: %v\n", err)
			}
		}
	}
}

// ======================= mailbox =======================

func (s *Service) mailboxLoop(ctx context.Context, sess *UserSession) {
	defer s.sessWG.Done()
	s.pollMailbox(ctx, sess)
	ticker := time.NewTicker(mailboxPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.pollMailbox(ctx, sess)
		}
	}
}

func (s *Service) pollMailbox(ctx context.Context, sess *UserSession) {
	fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	items, err := s.node.MailboxFetch(fetchCtx, s.cfg.ServerAddr, sess.SessionID)
	cancel()
	if err != nil {
		if ctx.Err() == nil {
			fmt.Printf("mailbox fetch: %v\n", err)
		}
		return
	}
	var ack []int64
	for _, item := range items {
		msg, err := protocol.UnmarshalMessage(item.Data)
		if err != nil {
			ack = append(ack, item.ID)
			continue
		}
		if err := protocol.ValidateMessage(msg); err != nil {
			fmt.Printf("mailbox: dropping invalid message %d: %v\n", item.ID, err)
			ack = append(ack, item.ID)
			continue
		}
		if msg.Type != protocol.MsgChat {
			ack = append(ack, item.ID)
			continue
		}
		err = s.ingestChat(sess, msg, "offline")
		if err == nil || isPermanent(err) {
			if err != nil {
				fmt.Printf("mailbox: dropping message %d: %v\n", item.ID, err)
			}
			ack = append(ack, item.ID)
			continue
		}
		fmt.Printf("mailbox: message %d will be retried: %v\n", item.ID, err)
	}
	if len(ack) > 0 {
		ackCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		if err := s.node.MailboxAck(ackCtx, s.cfg.ServerAddr, sess.SessionID, ack); err != nil {
			fmt.Printf("mailbox ack: %v\n", err)
		}
		cancel()
	}
}

// ======================= presence =======================

func (s *Service) genIs(gen uint64) bool {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	return s.session != nil && s.sessGen == gen
}

func (s *Service) startPresence(ctx context.Context, sess *UserSession, gen uint64) {
	if strings.TrimSpace(s.cfg.ServerAddr) == "" {
		return
	}
	err := s.node.StartPresence(
		ctx,
		s.cfg.ServerAddr,
		sess.UserID,
		sess.FName,
		sess.SName,
		func(users []protocol.PresenceUser) { s.onPresenceSnapshot(gen, users) },
		func(u protocol.PresenceUser, status string) { s.onPresenceUpdate(gen, u, status) },
	)
	if err != nil && ctx.Err() == nil {
		s.emitError(fmt.Errorf("start presence: %w", err))
	}
}

func (s *Service) onPresenceSnapshot(gen uint64, users []protocol.PresenceUser) {
	if !s.genIs(gen) {
		return
	}
	now := time.Now().UnixMilli()
	s.stateMu.Lock()
	s.onlineUsers = make(map[string]OnlineUser, len(users))
	for _, u := range users {
		s.onlineUsers[u.UserID] = OnlineUser{
			UserID: u.UserID, PeerID: u.PeerID, FName: u.FName, SName: u.SName,
			Online: true, LastSeen: now,
		}
	}
	s.stateMu.Unlock()
	s.emit(Event{Type: "online_snapshot", Timestamp: now})
}

func (s *Service) onPresenceUpdate(gen uint64, user protocol.PresenceUser, status string) {
	if !s.genIs(gen) {
		return
	}
	now := time.Now().UnixMilli()
	online := status == protocol.PresenceStatusOnline
	entry := OnlineUser{
		UserID: user.UserID, PeerID: user.PeerID, FName: user.FName, SName: user.SName,
		Online: online, LastSeen: now,
	}
	s.stateMu.Lock()
	if online {
		s.onlineUsers[user.UserID] = entry
	} else {
		delete(s.onlineUsers, user.UserID)
	}
	s.stateMu.Unlock()
	s.emit(Event{Type: "online_user_updated", Timestamp: now, OnlineUser: &entry})
}

// ======================= session accessors =======================

func (s *Service) currentSession() (*UserSession, error) {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	if s.session == nil {
		return nil, fmt.Errorf("not logged in")
	}
	return s.session, nil
}

func (s *Service) CurrentUserInfo() (userID, fname, sname string, ok bool) {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	if s.session == nil {
		return "", "", "", false
	}
	return s.session.UserID, s.session.FName, s.session.SName, true
}

func (s *Service) CurrentIdentityPublicKey() ([]byte, bool) {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	if s.session == nil {
		return nil, false
	}
	return s.session.IdentityPublicKey, true
}

// ======================= keys =======================

func (s *Service) peerPublicKey(sess *UserSession, userID string) ([]byte, error) {
	s.stateMu.RLock()
	key, ok := s.peerKeys[userID]
	s.stateMu.RUnlock()
	if ok {
		return key, nil
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	resp, err := s.node.KeyLookup(ctx, s.cfg.ServerAddr, sess.SessionID, userID)
	if err != nil {
		return nil, fmt.Errorf("look up key of %q: %w", userID, err)
	}
	s.stateMu.Lock()
	s.peerKeys[userID] = resp.IdentityPublicKey
	if name := strings.TrimSpace(resp.FName + " " + resp.SName); name != "" {
		s.peerNames[userID] = name
	}
	s.stateMu.Unlock()
	return resp.IdentityPublicKey, nil
}

// chatKeyFor: ключ чата детерминированно считается из своего приватного и
// публичного ключа собеседника (его отдаёт сервер). Ничего не хранится на
// диске и не может "устареть" — поэтому ошибок вида "decrypt chat key" больше нет.
func (s *Service) chatKeyFor(sess *UserSession, peerUser, chatID string) ([]byte, error) {
	s.stateMu.RLock()
	key, ok := s.chatKeys[chatID]
	s.stateMu.RUnlock()
	if ok {
		return key, nil
	}
	pubBytes, err := s.peerPublicKey(sess, peerUser)
	if err != nil {
		return nil, err
	}
	localPriv, err := ecdh.X25519().NewPrivateKey(sess.IdentityPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("parse local identity key: %w", err)
	}
	remotePub, err := ecdh.X25519().NewPublicKey(pubBytes)
	if err != nil {
		return nil, fmt.Errorf("parse remote identity key: %w", err)
	}
	key, err = corecrypto.DeriveChatKey(localPriv, remotePub, chatID)
	if err != nil {
		return nil, fmt.Errorf("derive chat key: %w", err)
	}
	s.stateMu.Lock()
	s.chatKeys[chatID] = key
	s.stateMu.Unlock()
	return key, nil
}

// ======================= snapshot / events =======================

func (s *Service) Snapshot() (Snapshot, error) {
	contacts, err := corechat.ListContacts()
	if err != nil {
		return Snapshot{}, err
	}
	blocked, err := corechat.ListBlocked()
	if err != nil {
		return Snapshot{}, err
	}

	s.stateMu.RLock()
	neighbors := make([]PeerPresence, 0, len(s.neighbors))
	for _, item := range s.neighbors {
		neighbors = append(neighbors, item)
	}
	onlineUsers := make([]OnlineUser, 0, len(s.onlineUsers))
	for _, item := range s.onlineUsers {
		onlineUsers = append(onlineUsers, item)
	}
	s.stateMu.RUnlock()

	sort.Slice(neighbors, func(i, j int) bool {
		if neighbors[i].LastSeen == neighbors[j].LastSeen {
			return neighbors[i].PeerID < neighbors[j].PeerID
		}
		return neighbors[i].LastSeen > neighbors[j].LastSeen
	})
	sort.Slice(onlineUsers, func(i, j int) bool {
		if onlineUsers[i].LastSeen == onlineUsers[j].LastSeen {
			return onlineUsers[i].UserID < onlineUsers[j].UserID
		}
		return onlineUsers[i].LastSeen > onlineUsers[j].LastSeen
	})

	chats, err := s.listChats()
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{
		LocalID:     s.cfg.LocalID,
		Port:        s.cfg.Port,
		Contacts:    contacts,
		Blocked:     blocked,
		Neighbors:   neighbors,
		OnlineUsers: onlineUsers,
		Chats:       chats,
	}, nil
}

func (s *Service) Subscribe(buffer int) (<-chan Event, func()) {
	if buffer <= 0 {
		buffer = 32
	}
	ch := make(chan Event, buffer)
	s.subMu.Lock()
	s.subscribers[ch] = struct{}{}
	s.subMu.Unlock()
	return ch, func() {
		s.subMu.Lock()
		if _, ok := s.subscribers[ch]; ok {
			delete(s.subscribers, ch)
			close(ch)
		}
		s.subMu.Unlock()
	}
}

func (s *Service) emit(event Event) {
	s.subMu.RLock()
	defer s.subMu.RUnlock()
	for ch := range s.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

func (s *Service) emitError(err error) {
	if err == nil {
		return
	}
	s.emit(Event{Type: "error", Timestamp: time.Now().UnixMilli(), Error: err.Error()})
}

// ======================= chats =======================

func (s *Service) ListMessages(chatID string) ([]UIMessage, error) {
	if _, err := s.currentSession(); err != nil {
		return nil, err
	}
	items := history.LoadMessages(strings.TrimSpace(chatID))
	out := make([]UIMessage, 0, len(items))
	for _, m := range items {
		direction := "incoming"
		if m.Outgoing {
			direction = "outgoing"
		}
		out = append(out, UIMessage{
			MessageID: m.MessageID,
			ChatID:    m.ChatID,
			TargetID:  m.TargetID,
			From:      m.From,
			Text:      m.Text,
			Timestamp: m.Timestamp,
			Direction: direction,
			Strategy:  m.Strategy,
		})
	}
	return out, nil
}

func (s *Service) ClearChatHistory() error {
	if _, err := s.currentSession(); err != nil {
		return err
	}
	history.ClearChatHistory()
	s.stateMu.Lock()
	s.unread = make(map[string]int)
	s.stateMu.Unlock()
	s.emit(Event{Type: "chat_history_deleted", Timestamp: time.Now().UnixMilli()})
	return nil
}

// OpenPrivateChat открывает чат с ПОЛЬЗОВАТЕЛЕМ, а не с устройством.
// userID (если фронтенд его знает) имеет приоритет; иначе логин берётся из
// presence-списка сервера по peerID — никаких кэшей "peer -> user", которые
// устаревают, когда за тем же ПК заходит другой аккаунт.
func (s *Service) OpenPrivateChat(peerID, peerAddr, name, userID string) (ChatSummary, error) {
	sess, err := s.currentSession()
	if err != nil {
		return ChatSummary{}, err
	}
	peerID = strings.TrimSpace(peerID)
	peerAddr = strings.TrimSpace(peerAddr)
	name = strings.TrimSpace(name)
	peerUser := strings.TrimSpace(userID)

	if peerID == "" && peerUser == "" {
		return ChatSummary{}, fmt.Errorf("peer_id is required")
	}
	if peerID != "" {
		if blocked, err := corechat.IsBlocked(peerID); err != nil {
			return ChatSummary{}, err
		} else if blocked {
			return ChatSummary{}, fmt.Errorf("peer is blocked: %s", peerID)
		}
		if peerAddr != "" && s.node != nil {
			_ = s.node.RememberHint(peerID, peerAddr)
		}
	}
	if peerUser == "" {
		peerUser, err = s.resolveUserID(peerID)
		if err != nil {
			return ChatSummary{}, err
		}
	}
	if peerUser == sess.UserID {
		return ChatSummary{}, fmt.Errorf("cannot open a chat with yourself")
	}
	if peerID == "" {
		peerID = s.peerIDForUser(peerUser)
	}

	title := s.displayName(peerUser)
	if title == "" {
		title = name
	}
	if title == "" {
		title = peerUser
	}
	chatID := privateChatID(sess.UserID, peerUser)
	history.TouchChat(history.ChatRecord{
		ChatID:     chatID,
		PeerID:     peerID,
		PeerUserID: peerUser,
		Title:      title,
	})
	return s.chatSummaryByID(chatID)
}

func (s *Service) SendMessage(chatID, targetPeerID, text string) (UIMessage, error) {
	sess, err := s.currentSession()
	if err != nil {
		return UIMessage{}, err
	}
	chatID = strings.TrimSpace(chatID)
	text = strings.TrimSpace(text)
	if chatID == "" || text == "" {
		return UIMessage{}, fmt.Errorf("chat_id and text are required")
	}
	rec, ok := history.GetChatRecord(chatID)
	if !ok || rec.PeerUserID == "" {
		return UIMessage{}, fmt.Errorf("chat not found: %s", chatID)
	}
	if rec.PeerID != "" {
		if blocked, _ := corechat.IsBlocked(rec.PeerID); blocked {
			return UIMessage{}, fmt.Errorf("peer is blocked: %s", rec.PeerID)
		}
	}

	key, err := s.chatKeyFor(sess, rec.PeerUserID, chatID)
	if err != nil {
		return UIMessage{}, err
	}
	payload, err := corecrypto.WrapKey([]byte(text), key)
	if err != nil {
		return UIMessage{}, fmt.Errorf("encrypt message: %w", err)
	}

	peerOnline := s.isUserOnline(rec.PeerUserID)
	targetPeer := s.peerIDForUser(rec.PeerUserID)
	if targetPeer == "" {
		targetPeer = rec.PeerID
	}
	if targetPeer == "" {
		targetPeer = strings.TrimSpace(targetPeerID)
	}
	if targetPeer == "" {
		targetPeer = "offline"
	}

	msg := protocol.Message{
		Version:  protocol.ProtocolVersion,
		Type:     protocol.MsgChat,
		Target:   protocol.TargetPeer,
		Strategy: protocol.StrategyUnknown,
		TTL:      1,
		TargetID: targetPeer,
		ChatID:   chatID,
		// From — PeerID устройства (так требует ValidateMessage), а кто именно
		// пишет и кому — логины, подписанные вместе с сообщением.
		From:       s.cfg.LocalID,
		FromUser:   sess.UserID,
		TargetUser: rec.PeerUserID,
		Payload:    payload,
		Timestamp:  time.Now().UnixMilli(),
	}
	if err := msg.Sign(s.identity.PrivateKey); err != nil {
		return UIMessage{}, err
	}

	strategy, err := s.routeMessage(sess, msg, peerOnline)
	if err != nil {
		return UIMessage{}, err
	}

	history.SaveMessage(history.StoredMessage{
		MessageID: msg.ID,
		ChatID:    chatID,
		TargetID:  targetPeer,
		From:      sess.UserID,
		Text:      text,
		Timestamp: msg.Timestamp,
		Outgoing:  true,
		Strategy:  strategy.String(),
	})
	history.TouchChat(history.ChatRecord{
		ChatID:        chatID,
		LastMessage:   text,
		LastTimestamp: msg.Timestamp,
	})

	ui := UIMessage{
		MessageID: msg.ID,
		ChatID:    chatID,
		TargetID:  targetPeer,
		From:      sess.UserID,
		Text:      text,
		Timestamp: msg.Timestamp,
		Direction: "outgoing",
		Strategy:  strategy.String(),
	}
	summary, _ := s.chatSummaryByID(chatID)
	s.emit(Event{Type: "message_sent", Timestamp: time.Now().UnixMilli(), Message: &ui, Chat: &summary})
	return ui, nil
}

// routeMessage: если собеседник онлайн — напрямую/через relay с подтверждением
// приёма; иначе (или если не вышло) — в почтовый ящик на сервере, откуда он
// заберёт сообщение при входе.
func (s *Service) routeMessage(sess *UserSession, msg protocol.Message, peerOnline bool) (protocol.Strategy, error) {
	if peerOnline {
		directCtx, cancel := context.WithTimeout(s.ctx, directSendTimeout)
		strategy, err := s.node.SendDirect(directCtx, msg, false)
		cancel()
		if err == nil {
			return strategy, nil
		}
		fmt.Printf("routeMessage: direct failed msg=%s: %v\n", msg.ID, err)

		relayCtx, cancel := context.WithTimeout(s.ctx, relaySendTimeout)
		strategy, err = s.node.SendDirect(relayCtx, msg, true)
		cancel()
		if err == nil {
			return strategy, nil
		}
		fmt.Printf("routeMessage: relay failed msg=%s: %v\n", msg.ID, err)
	}

	raw, err := protocol.MarshalMessage(msg)
	if err != nil {
		return protocol.StrategyUnknown, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	if err := s.node.MailboxPush(ctx, s.cfg.ServerAddr, sess.SessionID, msg.TargetUser, raw); err != nil {
		return protocol.StrategyUnknown, fmt.Errorf("message could not be delivered: %w", err)
	}
	fmt.Printf("routeMessage: msg=%s queued on server for %s\n", msg.ID, msg.TargetUser)
	return protocol.StrategyOffline, nil
}

// handlePacket вызывается для пакета, пришедшего напрямую по p2p. Возвращённая
// ошибка уходит отправителю, и он доставит сообщение через сервер.
func (s *Service) handlePacket(msg protocol.Message, sender peer.AddrInfo) error {
	now := time.Now()
	senderID := sender.ID.String()
	if blocked, err := corechat.IsBlocked(senderID); err == nil && blocked {
		return errors.New("blocked")
	}
	if !s.allowRate(senderID, now, 20, 40) {
		return errors.New("rate limited")
	}
	s.registerNeighbor(senderID, bestAddr(sender))

	switch msg.Type {
	case protocol.MsgJoin, protocol.MsgJoinAck:
		if summary, err := s.chatSummaryByID(msg.ChatID); err == nil {
			s.emit(Event{Type: "chat_updated", Timestamp: now.UnixMilli(), Chat: &summary})
		}
		return nil
	case protocol.MsgChat:
		if msg.TargetID != s.cfg.LocalID {
			return errors.New("not addressed to this device")
		}
		sess, err := s.currentSession()
		if err != nil {
			return errors.New("recipient is not logged in")
		}
		return s.ingestChat(sess, msg, msg.Strategy.String())
	}
	return nil
}

// ingestChat — общий путь для сообщений из p2p и из mailbox.
func (s *Service) ingestChat(sess *UserSession, msg protocol.Message, via string) error {
	if msg.TargetUser != sess.UserID {
		return permanent("message is addressed to %q, this session is %q", msg.TargetUser, sess.UserID)
	}
	if msg.FromUser == "" || msg.ChatID != privateChatID(msg.FromUser, msg.TargetUser) {
		return permanent("inconsistent chat id")
	}
	if blocked, _ := corechat.IsBlocked(msg.From); blocked {
		return nil
	}
	if history.HasMessage(msg.ID) {
		return nil
	}

	key, err := s.chatKeyFor(sess, msg.FromUser, msg.ChatID)
	if err != nil {
		if strings.Contains(err.Error(), "user not found") {
			return permanent("%v", err)
		}
		return err
	}
	plaintext, err := corecrypto.UnwrapKey(msg.Payload, key)
	if err != nil {
		return permanent("decrypt message: %w", err)
	}
	text := string(plaintext)

	if !history.SaveMessage(history.StoredMessage{
		MessageID: msg.ID,
		ChatID:    msg.ChatID,
		TargetID:  msg.TargetID,
		From:      msg.FromUser,
		Text:      text,
		Timestamp: msg.Timestamp,
		Outgoing:  false,
		Strategy:  via,
	}) {
		return nil
	}
	history.TouchChat(history.ChatRecord{
		ChatID:        msg.ChatID,
		PeerID:        msg.From,
		PeerUserID:    msg.FromUser,
		Title:         s.displayName(msg.FromUser),
		LastMessage:   text,
		LastTimestamp: msg.Timestamp,
	})

	s.stateMu.Lock()
	s.unread[msg.ChatID]++
	s.stateMu.Unlock()

	ui := UIMessage{
		MessageID: msg.ID,
		ChatID:    msg.ChatID,
		TargetID:  msg.TargetID,
		From:      msg.FromUser,
		Text:      text,
		Timestamp: msg.Timestamp,
		Direction: "incoming",
		Strategy:  via,
	}
	summary, _ := s.chatSummaryByID(msg.ChatID)
	s.emit(Event{Type: "message_received", Timestamp: time.Now().UnixMilli(), Message: &ui, Chat: &summary})
	return nil
}

func (s *Service) MarkChatRead(chatID string) error {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return fmt.Errorf("chat_id is required")
	}
	s.stateMu.Lock()
	delete(s.unread, chatID)
	s.stateMu.Unlock()
	summary, err := s.chatSummaryByID(chatID)
	if err != nil {
		return err
	}
	s.emit(Event{Type: "chat_read", Timestamp: time.Now().UnixMilli(), Chat: &summary})
	return nil
}

// ======================= contacts / blocklist =======================

func (s *Service) AddContact(contact corechat.Contact) (corechat.Contact, error) {
	sess, err := s.currentSession()
	if err != nil {
		return corechat.Contact{}, err
	}
	if err := corechat.AddContact(contact); err != nil {
		return corechat.Contact{}, err
	}
	created, err := corechat.FindContact(strings.TrimSpace(contact.PeerID))
	if err != nil {
		return corechat.Contact{}, err
	}
	if s.node != nil {
		_ = s.node.RememberHint(created.PeerID, created.Address())
	}
	if userID := s.userForPeer(created.PeerID); userID != "" && userID != sess.UserID {
		history.TouchChat(history.ChatRecord{
			ChatID:     privateChatID(sess.UserID, userID),
			PeerID:     created.PeerID,
			PeerUserID: userID,
			Title:      created.Name,
		})
	}
	s.emit(Event{Type: "contact_added", Timestamp: time.Now().UnixMilli(), Contact: &created})
	return created, nil
}

func (s *Service) RenameContact(query, newName string) (corechat.Contact, error) {
	if err := corechat.RenameContact(query, newName); err != nil {
		return corechat.Contact{}, err
	}
	updated, err := corechat.FindContact(newName)
	if err != nil {
		return corechat.Contact{}, err
	}
	s.emit(Event{Type: "contact_updated", Timestamp: time.Now().UnixMilli(), Contact: &updated})
	return updated, nil
}

func (s *Service) DeleteContact(query string) error {
	contact, err := corechat.FindContact(query)
	if err != nil {
		return err
	}
	if err := corechat.DeleteContact(contact.PeerID); err != nil {
		return err
	}
	s.emit(Event{Type: "contact_deleted", Timestamp: time.Now().UnixMilli()})
	return nil
}

func (s *Service) BlockPeer(query, reason string) (corechat.BlockedPeer, error) {
	if err := corechat.AddBlocked(query, reason); err != nil {
		return corechat.BlockedPeer{}, err
	}
	items, err := corechat.ListBlocked()
	if err != nil {
		return corechat.BlockedPeer{}, err
	}
	for _, item := range items {
		if item.PeerID == query || strings.EqualFold(item.Name, query) {
			s.emit(Event{Type: "peer_blocked", Timestamp: time.Now().UnixMilli(), Blocked: &item})
			return item, nil
		}
	}
	return corechat.BlockedPeer{}, fmt.Errorf("blocked peer not found after update")
}
func (s *Service) DeleteChat(chatID string) error {
	sess, err := s.currentSession()
	if err != nil {
		return err
	}
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return fmt.Errorf("chat_id is required")
	}
	if !history.DeleteChat(chatID) {
		return fmt.Errorf("chat not found: %s", chatID)
	}
	s.stateMu.Lock()
	delete(s.unread, chatID)
	s.stateMu.Unlock()

	if err := s.flushVault(sess, false); err != nil {
		fmt.Printf("delete chat: vault upload will be retried by autosave: %v\n", err)
	}

	s.emit(Event{Type: "chat_deleted", Timestamp: time.Now().UnixMilli()})
	return nil
}
func (s *Service) UnblockPeer(query string) error {
	if err := corechat.RemoveBlocked(query); err != nil {
		return err
	}
	s.emit(Event{Type: "peer_unblocked", Timestamp: time.Now().UnixMilli()})
	return nil
}

func (s *Service) UpdateLocalPeerID(peerID string) error {
	return fmt.Errorf("peer_id is derived from .identity and cannot be changed from UI")
}

// ======================= invites =======================

func (s *Service) GetInviteCode() (InviteCode, error) {
	code := fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
	rec, err := s.node.PublishInvite(code, defaultInviteTTL)
	if err != nil {
		return InviteCode{}, err
	}
	return InviteCode{Code: code, PeerID: rec.PeerID, ExpiresAt: rec.ExpiresAt}, nil
}

func (s *Service) ResolveInviteCode(code string) (string, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
	defer cancel()
	peerID, err := s.node.ResolveInvite(ctx, code)
	if err != nil {
		return "", fmt.Errorf("код не найден или сеть недоступна: %w", err)
	}
	return peerID, nil
}

// ======================= neighbors (LAN discovery) =======================

func (s *Service) handlePeer(info peer.AddrInfo) {
	if info.ID.String() == s.cfg.LocalID {
		return
	}
	s.registerNeighbor(info.ID.String(), bestAddr(info))

	peerID := info.ID.String()
	s.stateMu.Lock()
	last := s.whoamiAt[peerID]
	due := time.Since(last) > whoamiRefreshMinimum
	if due {
		s.whoamiAt[peerID] = time.Now()
	}
	s.stateMu.Unlock()
	if due {
		go s.resolveWhoAmI(peerID)
	}
}

func (s *Service) resolveWhoAmI(peerID string) {
	if s.node == nil {
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()
	resp, err := s.node.WhoAmI(ctx, peerID)
	if err != nil {
		return
	}
	displayName := strings.TrimSpace(resp.FName + " " + resp.SName)
	if displayName == "" {
		displayName = resp.UserID
	}
	s.stateMu.Lock()
	item, ok := s.neighbors[peerID]
	if ok {
		item.UserID = resp.UserID
		item.Name = displayName
		s.neighbors[peerID] = item
	}
	s.stateMu.Unlock()
	if !ok {
		return
	}
	s.emit(Event{Type: "peer_discovered", Timestamp: time.Now().UnixMilli(), Peer: &item})
}

func (s *Service) registerNeighbor(peerID, addr string) {
	peerID = strings.TrimSpace(peerID)
	addr = strings.TrimSpace(addr)
	if peerID == "" || peerID == s.cfg.LocalID {
		return
	}
	blocked, _ := corechat.IsBlocked(peerID)

	s.stateMu.Lock()
	existing, had := s.neighbors[peerID]
	item := PeerPresence{
		PeerID:   peerID,
		UserID:   existing.UserID,
		Name:     existing.Name,
		Addr:     addr,
		LastSeen: time.Now().UnixMilli(),
		Blocked:  blocked,
	}
	if item.Name == "" {
		item.Name = peerID
	}
	if item.Addr == "" && had {
		item.Addr = existing.Addr
	}
	s.neighbors[peerID] = item
	s.stateMu.Unlock()

	s.emit(Event{Type: "peer_discovered", Timestamp: item.LastSeen, Peer: &item})
}

// ======================= presence-based lookups =======================

func (s *Service) userForPeer(peerID string) string {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	var best OnlineUser
	for _, u := range s.onlineUsers {
		if u.PeerID == peerID && (best.UserID == "" || u.LastSeen > best.LastSeen) {
			best = u
		}
	}
	return best.UserID
}

func (s *Service) resolveUserID(peerID string) (string, error) {
	if userID := s.userForPeer(peerID); userID != "" {
		return userID, nil
	}
	// Запасной путь для устройств вне presence: спросить напрямую. Результат
	// намеренно НЕ кэшируется — на том же ПК может зайти другой аккаунт.
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()
	resp, err := s.node.WhoAmI(ctx, peerID)
	if err != nil {
		return "", fmt.Errorf("resolve user id for peer %s: %w", peerID, err)
	}
	return resp.UserID, nil
}

func (s *Service) peerIDForUser(userID string) string {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.onlineUsers[userID].PeerID
}

func (s *Service) isUserOnline(userID string) bool {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	_, ok := s.onlineUsers[userID]
	return ok
}

func (s *Service) displayName(userID string) string {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.displayNameLocked(userID)
}

func (s *Service) displayNameLocked(userID string) string {
	if u, ok := s.onlineUsers[userID]; ok {
		if n := strings.TrimSpace(u.FName + " " + u.SName); n != "" {
			return n
		}
	}
	return s.peerNames[userID]
}

func (s *Service) listChats() ([]ChatSummary, error) {
	records := history.ListChatRecords()
	contacts, err := corechat.ListContacts()
	if err != nil {
		return nil, err
	}
	blocked, err := corechat.ListBlocked()
	if err != nil {
		return nil, err
	}
	contactMap := make(map[string]corechat.Contact, len(contacts))
	for _, item := range contacts {
		contactMap[item.PeerID] = item
	}
	blockedSet := make(map[string]struct{}, len(blocked))
	for _, item := range blocked {
		blockedSet[item.PeerID] = struct{}{}
	}

	s.stateMu.RLock()
	defer s.stateMu.RUnlock()

	chats := make([]ChatSummary, 0, len(records))
	for _, record := range records {
		addr := ""
		title := ""
		if c, ok := contactMap[record.PeerID]; ok {
			addr = c.Address()
			title = c.Name
		} else if n, ok := s.neighbors[record.PeerID]; ok {
			addr = n.Addr
		}
		if title == "" {
			title = s.displayNameLocked(record.PeerUserID)
		}
		if title == "" {
			title = strings.TrimSpace(record.Title)
		}
		if title == "" {
			title = record.PeerUserID
		}
		if title == "" {
			title = record.PeerID
		}
		_, isBlocked := blockedSet[record.PeerID]
		_, online := s.onlineUsers[record.PeerUserID]
		chats = append(chats, ChatSummary{
			ChatID:        record.ChatID,
			PeerID:        record.PeerID,
			PeerUserID:    record.PeerUserID,
			Title:         title,
			Preview:       record.LastMessage,
			LastTimestamp: record.LastTimestamp,
			KnownAddr:     addr,
			Online:        online,
			Blocked:       isBlocked,
			UnreadCount:   s.unread[record.ChatID],
		})
	}
	sort.Slice(chats, func(i, j int) bool {
		if chats[i].LastTimestamp == chats[j].LastTimestamp {
			return chats[i].Title < chats[j].Title
		}
		return chats[i].LastTimestamp > chats[j].LastTimestamp
	})
	return chats, nil
}

func (s *Service) chatSummaryByID(chatID string) (ChatSummary, error) {
	chats, err := s.listChats()
	if err != nil {
		return ChatSummary{}, err
	}
	for _, item := range chats {
		if item.ChatID == chatID {
			return item, nil
		}
	}
	return ChatSummary{}, fmt.Errorf("chat not found: %s", chatID)
}

func (s *Service) allowRate(key string, now time.Time, ratePerSec, burst float64) bool {
	if key == "" {
		key = "unknown"
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	state, ok := s.rateStates[key]
	if !ok {
		s.rateStates[key] = &rateState{tokens: burst - 1, last: now}
		return true
	}
	elapsed := now.Sub(state.last).Seconds()
	state.tokens += elapsed * ratePerSec
	if state.tokens > burst {
		state.tokens = burst
	}
	state.last = now
	if state.tokens < 1 {
		return false
	}
	state.tokens--
	return true
}

func bestAddr(info peer.AddrInfo) string {
	if len(info.Addrs) == 0 {
		return ""
	}
	for _, addr := range info.Addrs {
		if !strings.Contains(addr.String(), "/p2p-circuit") {
			return addr.String()
		}
	}
	return info.Addrs[0].String()
}

func privateChatID(a, b string) string {
	if a <= b {
		return "dm:" + a + ":" + b
	}
	return "dm:" + b + ":" + a
}
