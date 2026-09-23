package app

import (
	corechat "Syne/core/chat"
	corecrypto "Syne/core/crypto"
	"Syne/core/history"
	p2ptransport "Syne/core/transport/p2p"
	"context"
	"crypto/ecdh"
	"database/sql"
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
	defaultHopTTL        = 4
	dedupCapacity        = 1000
	defaultInviteTTL     = 15 * time.Minute
	relayFallbackTimeout = 2 * time.Second
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

// OnlineUser — запись из presence-канала study-сервера: человек сейчас
// в сети (независимо от того, обнаружен ли он локально по mDNS/DHT).
// Именно на основе этого списка строится вкладка "Nearby".
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

type Service struct {
	cfg Config

	ctx      context.Context
	cancel   context.CancelFunc
	identity *corecrypto.Identity
	node     *p2ptransport.Node

	stateMu      sync.RWMutex
	neighbors    map[string]PeerPresence
	onlineUsers  map[string]OnlineUser
	identityKeys map[string][]byte
	seen         map[string]time.Time
	seenOrder    []string
	unread       map[string]int
	rateStates   map[string]*rateState

	presenceMu      sync.Mutex
	presenceStarted bool

	resolveMu       sync.Mutex
	resolveInFlight map[string]chan struct{}

	subMu       sync.RWMutex
	subscribers map[chan Event]struct{}

	sessionMu sync.RWMutex
	session   *UserSession

	wg sync.WaitGroup
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
		ctx:             ctx,
		cancel:          cancel,
		identity:        identity,
		neighbors:       make(map[string]PeerPresence),
		onlineUsers:     make(map[string]OnlineUser),
		identityKeys:    make(map[string][]byte),
		seen:            make(map[string]time.Time),
		unread:          make(map[string]int),
		rateStates:      make(map[string]*rateState),
		resolveInFlight: make(map[string]chan struct{}),
		subscribers:     make(map[chan Event]struct{}),
	}, nil
}
func (s *Service) resolveIdentityKey(peerID string) ([]byte, error) {
	s.stateMu.RLock()
	if key, ok := s.identityKeys[peerID]; ok {
		s.stateMu.RUnlock()
		return key, nil
	}
	s.stateMu.RUnlock()

	var lastErr error
	for attempt, timeout := range []time.Duration{10 * time.Second, 20 * time.Second} {
		ctx, cancel := context.WithTimeout(s.ctx, timeout)
		resp, err := s.node.GetIdentityKey(ctx, peerID)
		cancel()
		if err == nil {
			s.stateMu.Lock()
			s.identityKeys[peerID] = resp.IdentityPublicKey
			s.stateMu.Unlock()
			return resp.IdentityPublicKey, nil
		}
		lastErr = err
		if attempt == 0 {
			fmt.Printf("resolve identity key for peer %s: attempt %d failed, retrying with longer timeout: %v\n", peerID, attempt+1, err)
		}
	}
	return nil, fmt.Errorf("resolve identity key for peer %s: %w", peerID, lastErr)
}
func (s *Service) deriveChatKeyWith(peerID, chatID string, session *UserSession) ([]byte, error) {
	// 1. Пробуем локальный кэш — работает офлайн.
	wrapped, err := history.LoadChatKey(chatID)
	if err == nil {
		return corecrypto.UnwrapKey(wrapped, session.MasterKey)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load cached chat key: %w", err)
	}

	// 2. Ключа ещё нет — вычисляем через сеть (нужен собеседник онлайн).
	remotePubBytes, err := s.resolveIdentityKey(peerID)
	if err != nil {
		return nil, fmt.Errorf("resolve remote identity key: %w", err)
	}

	localPriv, err := ecdh.X25519().NewPrivateKey(session.IdentityPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("parse local identity key: %w", err)
	}

	remotePub, err := ecdh.X25519().NewPublicKey(remotePubBytes)
	if err != nil {
		return nil, fmt.Errorf("parse remote identity key: %w", err)
	}

	chatKey, err := corecrypto.DeriveChatKey(localPriv, remotePub, chatID)
	if err != nil {
		return nil, fmt.Errorf("derive chat key: %w", err)
	}

	// 3. Сохраняем в кэш на будущее — теперь офлайн-доступ работает.
	wrappedNew, err := corecrypto.WrapKey(chatKey, session.MasterKey)
	if err != nil {
		return nil, fmt.Errorf("wrap chat key for cache: %w", err)
	}
	if err := history.SaveChatKey(chatID, wrappedNew); err != nil {
		return nil, fmt.Errorf("save chat key to cache: %w", err)
	}

	return chatKey, nil
}
func (s *Service) CurrentUserInfo() (userID, fname, sname string, ok bool) {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	if s.session == nil {
		return "", "", "", false
	}
	return s.session.UserID, s.session.FName, s.session.SName, true

}
func (s *Service) Start() error {
	if err := history.UpsertPeerAlias(s.cfg.LocalID, "You"); err != nil {
		return err
	}
	if err := history.TouchChat(history.ChatRecord{}); err != nil {
		return err
	}
	node, err := p2ptransport.NewNode(s.ctx, s.identity, s.handlePacket, s.handlePeer)
	if err != nil {
		return err
	}
	s.node = node
	if err := s.bootstrapContactHints(); err != nil {
		return err
	}

	serverAddr := strings.TrimSpace(s.cfg.ServerAddr)
	if serverAddr == "" {
		// Автопоиск по умолчанию: ищем study-сервер в локальной сети через
		// mDNS вместо того чтобы требовать ручной адрес. mDNS работает
		// только в пределах одного сегмента сети (одна точка доступа/
		// свитч) — если сервер за роутером или в другой подсети, здесь
		// ничего не найдётся, и приложение просто продолжит без сервера,
		// как и раньше при пустом ServerAddr. Ручной адрес (флаг
		// --server-addr / файл конфигурации на клиенте) остаётся рабочим
		// запасным вариантом именно для таких сетей.
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
	s.wg.Add(1)
	go s.retryOutboxLoop()
	return nil
}

func (s *Service) Stop() {
	s.cancel()
	if s.node != nil {
		_ = s.node.Close()
	}
	s.wg.Wait()

	s.subMu.Lock()
	for ch := range s.subscribers {
		close(ch)
	}
	s.subscribers = map[chan Event]struct{}{}
	s.subMu.Unlock()
}

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
func (s *Service) Login(login, password string) error {
	result, err := s.node.Login(s.ctx, s.cfg.ServerAddr, login, password)
	if err != nil {
		return err
	}
	s.sessionMu.Lock()
	s.session = &UserSession{
		UserID:             login,
		SessionID:          result.SessionID,
		MasterKey:          result.MasterKey,
		IdentityPrivateKey: result.IdentityPrivateKey,
		IdentityPublicKey:  result.IdentityPublicKey,
		FName:              result.FName,
		SName:              result.SName,
	}
	s.sessionMu.Unlock()
	s.emit(Event{
		Type:      "logged_in",
		Timestamp: time.Now().UnixMilli(),
	})
	s.startPresence()
	return nil
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
	s.sessionMu.Lock()
	s.session = &UserSession{
		UserID:             login,
		SessionID:          result.SessionID,
		MasterKey:          result.MasterKey,
		IdentityPrivateKey: result.IdentityPrivateKey,
		IdentityPublicKey:  result.IdentityPublicKey,
		FName:              result.FName,
		SName:              result.SName,
	}
	s.sessionMu.Unlock()
	s.emit(Event{
		Type:      "logged_in",
		Timestamp: time.Now().UnixMilli(),
	})
	s.startPresence()
	return nil
}

// startPresence сообщает study-серверу "я в сети" и начинает слушать
// обновления о других пользователях (см. Syne-protocol/presence.go).
// Идемпотентна — повторный вызов в рамках одного запуска процесса
// ничего не делает.
func (s *Service) startPresence() {
	s.presenceMu.Lock()
	if s.presenceStarted {
		s.presenceMu.Unlock()
		return
	}
	s.presenceStarted = true
	s.presenceMu.Unlock()

	if strings.TrimSpace(s.cfg.ServerAddr) == "" {
		return // нет study-сервера — presence недоступен (чистый P2P-режим)
	}

	session, err := s.currentSession()
	if err != nil {
		return
	}

	go func() {
		err := s.node.StartPresence(
			s.ctx,
			s.cfg.ServerAddr,
			session.UserID,
			session.FName,
			session.SName,
			s.onPresenceSnapshot,
			s.onPresenceUpdate,
		)
		if err != nil {
			s.emitError(fmt.Errorf("start presence: %w", err))
		}
	}()
}

func (s *Service) onPresenceSnapshot(users []protocol.PresenceUser) {
	now := time.Now().UnixMilli()
	s.stateMu.Lock()
	for _, u := range users {
		s.onlineUsers[u.UserID] = OnlineUser{
			UserID:   u.UserID,
			PeerID:   u.PeerID,
			FName:    u.FName,
			SName:    u.SName,
			Online:   true,
			LastSeen: now,
		}
	}
	s.stateMu.Unlock()

	s.emit(Event{
		Type:      "online_snapshot",
		Timestamp: now,
	})
}

func (s *Service) onPresenceUpdate(user protocol.PresenceUser, status string) {
	now := time.Now().UnixMilli()
	online := status == protocol.PresenceStatusOnline

	entry := OnlineUser{
		UserID:   user.UserID,
		PeerID:   user.PeerID,
		FName:    user.FName,
		SName:    user.SName,
		Online:   online,
		LastSeen: now,
	}

	s.stateMu.Lock()
	if online {
		s.onlineUsers[user.UserID] = entry
	} else {
		delete(s.onlineUsers, user.UserID)
	}
	s.stateMu.Unlock()

	s.emit(Event{
		Type:       "online_user_updated",
		Timestamp:  now,
		OnlineUser: &entry,
	})
}

func (s *Service) currentSession() (*UserSession, error) {
	defer s.sessionMu.RUnlock()
	s.sessionMu.RLock()
	if s.session == nil {
		return nil, fmt.Errorf("not logged in")
	}
	return s.session, nil

}
func (s *Service) CurrentIdentityPublicKey() ([]byte, bool) {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	if s.session == nil {
		return nil, false
	}
	return s.session.IdentityPublicKey, true
}
func (s *Service) Logout() error {
	defer s.sessionMu.Unlock()
	s.sessionMu.Lock()
	if s.session == nil {
		return fmt.Errorf("not logged in")
	}
	// TODO: здесь позже появится вызов синхронизации истории на сервер, до очистки session
	s.session = nil
	return nil
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

func (s *Service) ListMessages(chatID string) ([]UIMessage, error) {
	session, err := s.currentSession()
	if err != nil {
		return nil, err
	}
	items, err := history.LoadMessages(strings.TrimSpace(chatID))
	if err != nil {
		return nil, err
	}
	wrapped, err := history.LoadChatKey(chatID)
	if err != nil {
		return nil, fmt.Errorf("chat key not found, cannot decrypt history: %w", err)
	}
	chatKey, err := corecrypto.UnwrapKey(wrapped, session.MasterKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt chat key: %w", err)
	}
	messages := make([]UIMessage, 0, len(items))
	for _, item := range items {
		plaintext, err := corecrypto.UnwrapKey(item.Payload, chatKey)
		if err != nil {
			return nil, fmt.Errorf("decrypt message %s: %w", item.MessageID, err)
		}
		direction := "incoming"
		if item.From == session.UserID {
			direction = "outgoing"
		}

		messages = append(messages, UIMessage{
			MessageID: item.MessageID,
			ChatID:    item.ChatID,
			TargetID:  item.TargetID,
			From:      item.From,
			Text:      string(plaintext),
			Timestamp: item.Timestamp,
			Direction: direction,
			Strategy:  item.Strategy.String(),
		})
	}
	return messages, nil
}

func (s *Service) ClearChatHistory() error {
	if err := history.ClearChatHistory(); err != nil {
		return err
	}
	s.stateMu.Lock()
	s.unread = make(map[string]int)
	s.stateMu.Unlock()
	s.emit(Event{
		Type:      "chat_history_deleted",
		Timestamp: time.Now().UnixMilli(),
	})
	return nil
}

func (s *Service) OpenPrivateChat(peerID, peerAddr, name string) (ChatSummary, error) {
	peerID = strings.TrimSpace(peerID)
	session, err := s.currentSession()
	if err != nil {
		return ChatSummary{}, err
	}
	peerAddr = strings.TrimSpace(peerAddr)
	name = strings.TrimSpace(name)
	if peerID == "" {
		return ChatSummary{}, fmt.Errorf("peer_id is required")
	}
	if blocked, err := corechat.IsBlocked(peerID); err != nil {
		return ChatSummary{}, err
	} else if blocked {
		return ChatSummary{}, fmt.Errorf("peer is blocked: %s", peerID)
	}
	if peerAddr != "" && s.node != nil {
		_ = s.node.RememberHint(peerID, peerAddr)
	}
	targetUserID, err := s.resolveUserID(peerID)
	if err != nil {
		return ChatSummary{}, err
	}
	chatID := privateChatID(session.UserID, targetUserID)
	title := name
	if title == "" {
		title = s.lookupPeerTitle(peerID)
	}
	if err := history.TouchChat(history.ChatRecord{
		ChatID: chatID,
		PeerID: peerID,
		Title:  title,
	}); err != nil {
		return ChatSummary{}, err
	}
	summary, err := s.chatSummaryByID(chatID)
	if err != nil {
		return ChatSummary{}, err
	}
	return summary, nil
}

func (s *Service) SendMessage(targetPeerID, text string) (UIMessage, error) {
	session, err := s.currentSession()
	if err != nil {
		return UIMessage{}, err
	}
	targetPeerID = strings.TrimSpace(targetPeerID)
	text = strings.TrimSpace(text)
	if targetPeerID == "" || text == "" {
		return UIMessage{}, fmt.Errorf("chat_id, target_id and text are required")
	}
	if blocked, err := corechat.IsBlocked(targetPeerID); err != nil {
		return UIMessage{}, err
	} else if blocked {
		return UIMessage{}, fmt.Errorf("peer is blocked: %s", targetPeerID)
	}
	targetUserID, err := s.resolveUserID(targetPeerID)
	if err != nil {
		return UIMessage{}, err
	}

	chatID := privateChatID(session.UserID, targetUserID)
	chatKey, err := s.deriveChatKeyWith(targetPeerID, chatID, session)
	if err != nil {
		return UIMessage{}, fmt.Errorf("derive chat key: %w", err)
	}

	encryptedPayload, err := corecrypto.WrapKey([]byte(text), chatKey)
	if err != nil {
		return UIMessage{}, fmt.Errorf("encrypt message: %w", err)
	}
	msg := protocol.Message{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.MsgChat,
		Target:    protocol.TargetPeer,
		Strategy:  protocol.StrategyUnknown,
		TTL:       defaultHopTTL,
		TargetID:  targetPeerID,
		ChatID:    chatID,
		From:      session.UserID,
		Payload:   encryptedPayload,
		Timestamp: time.Now().UnixMilli(),
	}
	if err := msg.Sign(s.identity.PrivateKey); err != nil {
		return UIMessage{}, err
	}

	strategy, err := s.routeMessage(msg)
	if err != nil {
		return UIMessage{}, err
	}
	msg.Strategy = strategy

	if err := history.SaveMessage(msg); err != nil {
		return UIMessage{}, err
	}
	if err := history.TouchChat(history.ChatRecord{
		ChatID:        chatID,
		PeerID:        targetPeerID,
		Title:         s.lookupPeerTitle(targetPeerID),
		LastMessage:   text,
		LastTimestamp: msg.Timestamp,
	}); err != nil {
		return UIMessage{}, err
	}

	ui := UIMessage{
		MessageID: msg.ID,
		ChatID:    msg.ChatID,
		TargetID:  msg.TargetID,
		From:      msg.From,
		Text:      text,
		Timestamp: msg.Timestamp,
		Direction: "outgoing",
		Strategy:  strategy.String(),
	}
	summary, _ := s.chatSummaryByID(chatID)
	s.emit(Event{
		Type:      "message_sent",
		Timestamp: time.Now().UnixMilli(),
		Message:   &ui,
		Chat:      &summary,
	})
	return ui, nil
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
	s.emit(Event{
		Type:      "chat_read",
		Timestamp: time.Now().UnixMilli(),
		Chat:      &summary,
	})
	return nil
}

func (s *Service) AddContact(contact corechat.Contact) (corechat.Contact, error) {
	session, err := s.currentSession()
	if err != nil {
		return corechat.Contact{}, err
	}
	if err := corechat.AddContact(contact); err != nil {
		return corechat.Contact{}, err
	}
	created, err := corechat.FindContact(contact.PeerID)
	if err != nil {
		return corechat.Contact{}, err
	}
	if err := history.UpsertPeerAlias(created.PeerID, created.Name); err != nil {
		return corechat.Contact{}, err
	}
	if s.node != nil {
		_ = s.node.RememberHint(created.PeerID, created.Address())
	}
	targetUserID, err := s.resolveUserID(created.PeerID)
	if err != nil {
		return corechat.Contact{}, err
	}
	chatID := privateChatID(session.UserID, targetUserID)
	if err := history.TouchChat(history.ChatRecord{
		ChatID: chatID,
		PeerID: created.PeerID,
		Title:  created.Name,
	}); err != nil {
		return corechat.Contact{}, err
	}
	s.emit(Event{
		Type:      "contact_added",
		Timestamp: time.Now().UnixMilli(),
		Contact:   &created,
	})
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
	if err := history.UpsertPeerAlias(updated.PeerID, updated.Name); err != nil {
		return corechat.Contact{}, err
	}
	s.emit(Event{
		Type:      "contact_updated",
		Timestamp: time.Now().UnixMilli(),
		Contact:   &updated,
	})
	return updated, nil
}

func (s *Service) DeleteContact(query string) error {
	contact, err := corechat.FindContact(query)
	if err != nil {
		return err
	}
	peerID := contact.PeerID

	if err := corechat.DeleteContact(peerID); err != nil {
		return err
	}
	if err := history.DeletePeerAlias(peerID); err != nil {
		return err
	}
	session, err := s.currentSession()
	if err != nil {
		return err
	}
	targetUserID, err := s.resolveUserID(peerID)
	if err != nil {
		return err
	}

	chatID := privateChatID(session.UserID, targetUserID)
	chatExists := false

	chats, err := s.listChats()
	if err != nil {
		return err
	}
	for _, item := range chats {
		if item.ChatID == chatID {
			chatExists = true
			break
		}
	}

	if chatExists {
		if err := history.TouchChat(history.ChatRecord{
			ChatID: chatID,
			PeerID: peerID,
			Title:  peerID,
		}); err != nil {
			return err
		}
	}

	s.emit(Event{
		Type:      "contact_deleted",
		Timestamp: time.Now().UnixMilli(),
	})

	if chatExists {
		summary, err := s.chatSummaryByID(chatID)
		if err != nil {
			return err
		}
		s.emit(Event{
			Type:      "chat_updated",
			Timestamp: time.Now().UnixMilli(),
			Chat:      &summary,
		})
	}

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
			s.emit(Event{
				Type:      "peer_blocked",
				Timestamp: time.Now().UnixMilli(),
				Blocked:   &item,
			})
			return item, nil
		}
	}
	return corechat.BlockedPeer{}, fmt.Errorf("blocked peer not found after update")
}

func (s *Service) UnblockPeer(query string) error {
	if err := corechat.RemoveBlocked(query); err != nil {
		return err
	}
	s.emit(Event{
		Type:      "peer_unblocked",
		Timestamp: time.Now().UnixMilli(),
	})
	return nil
}

func (s *Service) UpdateLocalPeerID(peerID string) error {
	return fmt.Errorf("peer_id is derived from .identity and cannot be changed from UI")
}

func (s *Service) GetInviteCode() (InviteCode, error) {
	code := fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
	rec, err := s.node.PublishInvite(code, defaultInviteTTL)
	if err != nil {
		return InviteCode{}, err
	}
	return InviteCode{
		Code:      code,
		PeerID:    rec.PeerID,
		ExpiresAt: rec.ExpiresAt,
	}, nil
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

func (s *Service) routeMessage(msg protocol.Message) (protocol.Strategy, error) {
	type result struct {
		strategy protocol.Strategy
		err      error
	}

	hopCh := make(chan result, 1)
	go func() {
		hopCtx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
		defer cancel()
		err := s.node.SendHop(hopCtx, msg, "")
		hopCh <- result{strategy: protocol.StrategyHop, err: err}
	}()

	directCtx, cancel := context.WithTimeout(s.ctx, relayFallbackTimeout)
	defer cancel()
	if strategy, err := s.node.SendDirect(directCtx, msg, false); err == nil {
		fmt.Printf("routeMessage: delivered msg=%s to=%s via direct\n", msg.ID, msg.TargetID)
		return strategy, nil
	} else {
		fmt.Printf("routeMessage: direct send failed msg=%s to=%s: %v\n", msg.ID, msg.TargetID, err)
	}

	if strategy, err := s.node.SendDirect(s.ctx, msg, true); err == nil {
		fmt.Printf("routeMessage: delivered msg=%s to=%s via relay\n", msg.ID, msg.TargetID)
		return strategy, nil
	} else {
		fmt.Printf("routeMessage: relay send failed msg=%s to=%s: %v\n", msg.ID, msg.TargetID, err)
	}

	hopResult := <-hopCh
	if hopResult.err == nil {
		fmt.Printf("routeMessage: delivered msg=%s to=%s via hop\n", msg.ID, msg.TargetID)
		return hopResult.strategy, nil
	}
	fmt.Printf("routeMessage: hop send failed msg=%s to=%s: %v\n", msg.ID, msg.TargetID, hopResult.err)

	msg.Strategy = protocol.StrategyOffline
	if err := history.QueueMessage(msg, time.Now().Add(10*time.Second).UnixMilli()); err != nil {
		fmt.Printf("routeMessage: failed to queue offline msg=%s to=%s: %v\n", msg.ID, msg.TargetID, err)
		return protocol.StrategyUnknown, err
	}
	fmt.Printf("routeMessage: msg=%s to=%s queued as OFFLINE (all delivery attempts failed)\n", msg.ID, msg.TargetID)
	return protocol.StrategyOffline, nil
}

func (s *Service) handlePacket(msg protocol.Message, sender peer.AddrInfo) {
	now := time.Now()
	if blocked, err := corechat.IsBlocked(sender.ID.String()); err != nil {
		s.emitError(err)
		return
	} else if blocked {
		return
	}
	if !s.allowRate(sender.ID.String(), now, 20, 40) {
		return
	}
	s.registerNeighbor(sender.ID.String(), bestAddr(sender), sender.ID.String())

	switch msg.Type {
	case protocol.MsgJoin, protocol.MsgJoinAck:
		if summary, err := s.chatSummaryByID(msg.ChatID); err == nil {
			s.emit(Event{
				Type:      "chat_updated",
				Timestamp: now.UnixMilli(),
				Chat:      &summary,
			})
		}
	case protocol.MsgChat:
		fmt.Printf("handlePacket: received chat msg=%s from=%s target=%s strategy=%s ttl=%d\n",
			msg.ID, msg.From, msg.TargetID, msg.Strategy.String(), msg.TTL)

		if s.isSeen(msg.ID, now, 10*time.Minute) {
			fmt.Printf("handlePacket: msg=%s already seen, dropping duplicate\n", msg.ID)
			return
		}
		if msg.TargetID != s.cfg.LocalID {
			fmt.Printf("handlePacket: msg=%s not for us (target=%s, local=%s)\n", msg.ID, msg.TargetID, s.cfg.LocalID)
			if msg.Strategy != protocol.StrategyHop || msg.TTL <= 1 {
				return
			}
			msg.TTL--
			_ = s.node.SendHop(s.ctx, msg, sender.ID.String())
			return
		}
		session, err := s.currentSession()
		if err != nil {
			fmt.Printf("handlePacket: msg=%s dropped, not logged in\n", msg.ID)
			return // не залогинены — не можем расшифровать, просто игнорируем сообщение
		}

		chatKey, err := s.deriveChatKeyWith(sender.ID.String(), msg.ChatID, session)
		if err != nil {
			fmt.Printf("handlePacket: msg=%s derive chat key FAILED: %v\n", msg.ID, err)
			s.emitError(fmt.Errorf("derive chat key: %w", err))
			return
		}

		plaintext, err := corecrypto.UnwrapKey(msg.Payload, chatKey)
		if err != nil {
			fmt.Printf("handlePacket: msg=%s decrypt FAILED: %v\n", msg.ID, err)
			s.emitError(fmt.Errorf("decrypt message: %w", err))
			return
		}
		fmt.Printf("handlePacket: msg=%s decrypted OK, saving to history\n", msg.ID)
		if err := history.SaveMessage(msg); err != nil {
			fmt.Printf("handlePacket: msg=%s SaveMessage FAILED: %v\n", msg.ID, err)
			s.emitError(err)
			return
		}
		if err := history.TouchChat(history.ChatRecord{
			ChatID:        msg.ChatID,
			PeerID:        sender.ID.String(),
			Title:         s.lookupPeerTitle(sender.ID.String()),
			LastMessage:   string(plaintext),
			LastTimestamp: msg.Timestamp,
		}); err != nil {
			s.emitError(err)
		}

		s.stateMu.Lock()
		s.unread[msg.ChatID]++
		s.stateMu.Unlock()

		ui := UIMessage{
			MessageID: msg.ID,
			ChatID:    msg.ChatID,
			TargetID:  msg.TargetID,
			From:      msg.From,
			Text:      string(plaintext),
			Timestamp: msg.Timestamp,
			Direction: "incoming",
			Strategy:  msg.Strategy.String(),
		}
		summary, _ := s.chatSummaryByID(msg.ChatID)
		s.emit(Event{
			Type:      "message_received",
			Timestamp: now.UnixMilli(),
			Message:   &ui,
			Chat:      &summary,
		})
	}
}

func (s *Service) handlePeer(info peer.AddrInfo) {
	if info.ID.String() == s.cfg.LocalID {
		return
	}
	s.registerNeighbor(info.ID.String(), bestAddr(info), info.ID.String())

	go s.resolveWhoAmI(info.ID.String())
}
func (s *Service) resolveWhoAmI(peerID string) {
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()

	resp, err := s.node.WhoAmI(ctx, peerID)
	if err != nil {
		return
	}

	displayName := strings.TrimSpace(fmt.Sprintf("%s %s", resp.FName, resp.SName))
	if displayName == "" {
		displayName = resp.UserID
	}

	// КЛЮЧЕВОЙ ФИКС: раньше резолвленное имя сохранялось только в
	// оперативную карту s.neighbors, которую registerNeighbor полностью
	// пересоздаёт на каждый пакет. lookupPeerTitle ищет имя через
	// history.LookupPeerAlias (постоянное хранилище в SQLite), а туда имя
	// никогда не попадало — поэтому уже после первого же отправленного
	// сообщения имя откатывалось обратно на голый PeerID. Теперь пишем
	// алиас в БД, и он переживёт любой последующий registerNeighbor.
	if displayName != "" {
		_ = history.UpsertPeerAlias(peerID, displayName)
	}

	s.stateMu.Lock()
	if item, ok := s.neighbors[peerID]; ok {
		item.UserID = resp.UserID
		item.Name = displayName
		s.neighbors[peerID] = item
	}
	s.stateMu.Unlock()

	s.emit(Event{
		Type:      "peer_discovered",
		Timestamp: time.Now().UnixMilli(),
		Peer:      &PeerPresence{PeerID: peerID, UserID: resp.UserID, Name: displayName},
	})
}
func (s *Service) registerNeighbor(peerID, addr, name string) {
	peerID = strings.TrimSpace(peerID)
	addr = strings.TrimSpace(addr)
	if peerID == "" || peerID == s.cfg.LocalID {
		return
	}
	blocked, _ := corechat.IsBlocked(peerID)
	displayName := s.lookupPeerTitle(peerID)

	s.stateMu.Lock()
	existing, hadExisting := s.neighbors[peerID]
	item := PeerPresence{
		PeerID: peerID,
		// Раньше UserID тут всегда обнулялся, потому что структура
		// пересоздавалась с нуля при КАЖДОМ отправленном/полученном пакете.
		// Это ломало кэш в resolveUserID и вынуждало заново резолвить
		// логин перед каждой отправкой сообщения — лишние сетевые запросы,
		// иногда конкурирующие с фоновым resolveWhoAmI и приводящие к
		// таймаутам/сбоям доставки. Теперь переносим уже известный UserID.
		UserID:   existing.UserID,
		Name:     displayName,
		Addr:     addr,
		LastSeen: time.Now().UnixMilli(),
		Blocked:  blocked,
	}
	if item.Addr == "" && hadExisting {
		// Событие могло прийти без адреса (например, повторный
		// handlePacket) — не затираем ранее известный адрес пустотой.
		item.Addr = existing.Addr
	}
	s.neighbors[peerID] = item
	s.stateMu.Unlock()

	s.emit(Event{
		Type:      "peer_discovered",
		Timestamp: item.LastSeen,
		Peer:      &item,
	})
}
func (s *Service) lookupPeerName(peerID string) string {
	if name, err := history.LookupPeerAlias(peerID); err == nil && name != "" {
		return name
	}
	contacts, err := corechat.ListContacts()
	if err != nil {
		return ""
	}
	for _, item := range contacts {
		if item.PeerID == peerID {
			return item.Name
		}
	}
	return ""
}

func (s *Service) lookupPeerTitle(peerID string) string {
	if name := s.lookupPeerName(peerID); name != "" {
		return name
	}
	return peerID
}

func (s *Service) listChats() ([]ChatSummary, error) {
	records, err := history.ListChatRecords()
	if err != nil {
		return nil, err
	}
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
		if item, ok := contactMap[record.PeerID]; ok {
			addr = item.Address()
		} else if neighbor, ok := s.neighbors[record.PeerID]; ok {
			addr = neighbor.Addr
		}
		title := strings.TrimSpace(record.Title)
		if alias := s.lookupPeerName(record.PeerID); alias != "" {
			title = alias
		}
		if title == "" {
			title = record.PeerID
		}
		_, isBlocked := blockedSet[record.PeerID]
		_, online := s.neighbors[record.PeerID]
		chats = append(chats, ChatSummary{
			ChatID:        record.ChatID,
			PeerID:        record.PeerID,
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

func (s *Service) resolveUserID(peerID string) (string, error) {
	s.stateMu.RLock()
	if item, ok := s.neighbors[peerID]; ok && item.UserID != "" {
		s.stateMu.RUnlock()
		return item.UserID, nil
	}
	s.stateMu.RUnlock()

	// Де-дупликация: если резолв для этого peer уже идёт (например, его
	// параллельно запустил и фоновый resolveWhoAmI из handlePeer, и это же
	// SendMessage), ждём результат первого запроса вместо того чтобы
	// открывать второй параллельный WhoAmI-stream к тому же peer — именно
	// такие гонки провоцируют таймауты мультиплексора вида
	// "no recent network activity".
	s.resolveMu.Lock()
	if wait, inFlight := s.resolveInFlight[peerID]; inFlight {
		s.resolveMu.Unlock()
		select {
		case <-wait:
			s.stateMu.RLock()
			item, ok := s.neighbors[peerID]
			s.stateMu.RUnlock()
			if ok && item.UserID != "" {
				return item.UserID, nil
			}
			return "", fmt.Errorf("resolve user id for peer %s: concurrent resolve did not succeed", peerID)
		case <-s.ctx.Done():
			return "", s.ctx.Err()
		}
	}
	done := make(chan struct{})
	s.resolveInFlight[peerID] = done
	s.resolveMu.Unlock()

	defer func() {
		s.resolveMu.Lock()
		delete(s.resolveInFlight, peerID)
		s.resolveMu.Unlock()
		close(done)
	}()

	userID, err := s.doResolveUserID(peerID)
	if err != nil {
		return "", err
	}
	return userID, nil
}

// doResolveUserID выполняет фактический сетевой запрос, с одной повторной
// попыткой при таймауте на более длинном интервале — единичный сетевой
// затык (NAT hole-punch не успел, relay ещё не переключился и т.п.) не
// должен целиком проваливать отправку сообщения.
func (s *Service) doResolveUserID(peerID string) (string, error) {
	var lastErr error
	for attempt, timeout := range []time.Duration{10 * time.Second, 20 * time.Second} {
		ctx, cancel := context.WithTimeout(s.ctx, timeout)
		resp, err := s.node.WhoAmI(ctx, peerID)
		cancel()
		if err == nil {
			s.stateMu.Lock()
			if item, ok := s.neighbors[peerID]; ok {
				item.UserID = resp.UserID
				s.neighbors[peerID] = item
			}
			s.stateMu.Unlock()
			return resp.UserID, nil
		}
		lastErr = err
		if attempt == 0 {
			fmt.Printf("resolve user id for peer %s: attempt %d failed, retrying with longer timeout: %v\n", peerID, attempt+1, err)
		}
	}
	return "", fmt.Errorf("resolve user id for peer %s: %w", peerID, lastErr)
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
	s.emit(Event{
		Type:      "error",
		Timestamp: time.Now().UnixMilli(),
		Error:     err.Error(),
	})
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

func (s *Service) isSeen(id string, now time.Time, ttl time.Duration) bool {
	if id == "" {
		return false
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if ts, ok := s.seen[id]; ok && now.Sub(ts) <= ttl {
		return true
	}
	s.seen[id] = now
	s.seenOrder = append(s.seenOrder, id)
	for len(s.seenOrder) > dedupCapacity {
		oldest := s.seenOrder[0]
		s.seenOrder = s.seenOrder[1:]
		delete(s.seen, oldest)
	}
	for key, ts := range s.seen {
		if now.Sub(ts) > ttl {
			delete(s.seen, key)
		}
	}
	return false
}

func (s *Service) retryOutboxLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.retryDueOutbox()
		}
	}
}

func (s *Service) retryDueOutbox() {
	session, err := s.currentSession()
	if err != nil {
		s.emitError(err)
		return
	}
	items, err := history.LoadDueOutbox(time.Now().UnixMilli(), 16)
	if err != nil {
		s.emitError(err)
		return
	}
	for _, item := range items {
		msg := protocol.Message{
			Version:   protocol.ProtocolVersion,
			Type:      protocol.MsgChat,
			Target:    protocol.TargetPeer,
			TTL:       item.TTL,
			TargetID:  item.TargetID,
			ChatID:    item.ChatID,
			From:      session.UserID,
			Payload:   item.Payload,
			Timestamp: item.CreatedAt,
		}
		msg.ID = item.MessageID

		if err := msg.Sign(s.identity.PrivateKey); err != nil {
			_ = history.UpdateOutboxFailure(
				item.MessageID,
				err.Error(),
				time.Now().Add(30*time.Second).UnixMilli(),
			)
			continue
		}
		strategy, err := s.routeMessage(msg)
		if err != nil {
			_ = history.UpdateOutboxFailure(item.MessageID, err.Error(), time.Now().Add(30*time.Second).UnixMilli())
			continue
		}
		msg.Strategy = strategy
		_ = history.SaveMessage(msg)
		_ = history.DeleteOutbox(item.MessageID)
	}
}

func (s *Service) bootstrapContactHints() error {
	contacts, err := corechat.ListContacts()
	if err != nil {
		return err
	}
	for _, item := range contacts {
		if item.Name != "" {
			_ = history.UpsertPeerAlias(item.PeerID, item.Name)
		}
		if s.node != nil {
			_ = s.node.RememberHint(item.PeerID, item.Address())
		}
	}
	return nil
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

var _ = errors.Is
