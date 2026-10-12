package app

import (
	corecrypto "Syne/core/crypto"
	"Syne/core/history"
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
)

const (
	groupPollInterval = 3 * time.Second
	groupChatPrefix   = "grp:"
)

func groupChatID(id int64) string      { return groupChatPrefix + strconv.FormatInt(id, 10) }
func isGroupChatID(chatID string) bool { return strings.HasPrefix(chatID, groupChatPrefix) }

func (s *Service) ownName(sess *UserSession) string {
	if n := strings.TrimSpace(sess.FName + " " + sess.SName); n != "" {
		return n
	}
	return sess.UserID
}

// senderName: имя автора сообщения; незнакомых спрашиваем у сервера один раз.
func (s *Service) senderName(sess *UserSession, login string) string {
	if login == sess.UserID {
		return s.ownName(sess)
	}
	if n := s.displayName(login); n != "" {
		return n
	}
	if _, err := s.peerPublicKey(sess, login); err == nil {
		if n := s.displayName(login); n != "" {
			return n
		}
	}
	s.stateMu.Lock()
	if s.peerNames[login] == "" {
		s.peerNames[login] = login // чтобы не спрашивать снова (например, пользователь удалён)
	}
	s.stateMu.Unlock()
	return login
}

func (s *Service) groupLoop(ctx context.Context, sess *UserSession) {
	defer s.sessWG.Done()
	s.pollGroups(ctx, sess)
	ticker := time.NewTicker(groupPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.pollGroups(ctx, sess)
		}
	}
}

func (s *Service) pollGroups(ctx context.Context, sess *UserSession) {
	addr := strings.TrimSpace(s.cfg.ServerAddr)
	if addr == "" {
		return
	}
	lctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	groups, err := s.node.GroupList(lctx, addr, sess.SessionID)
	cancel()
	if err != nil {
		if ctx.Err() == nil {
			fmt.Printf("group list: %v\n", err)
		}
		return
	}
	s.syncGroupMembership(groups)
	for _, g := range groups {
		if ctx.Err() != nil {
			return
		}
		s.fetchGroup(ctx, sess, addr, g)
	}
}

// syncGroupMembership: заводит чаты новых групп, обновляет ключи и стирает чаты групп,
// которых в списке больше нет (ученика убрали из группы или группу удалили).
func (s *Service) syncGroupMembership(groups []protocol.GroupInfo) {
	now := time.Now().UnixMilli()
	keys := make(map[string][]byte, len(groups))
	present := make(map[string]bool, len(groups))

	for _, g := range groups {
		id := groupChatID(g.ID)
		keys[id] = g.Key
		present[id] = true
		rec, ok := history.GetChatRecord(id)
		if !ok || rec.Title != g.Name || rec.Emoji != g.Emoji || rec.GroupID != g.ID {
			history.TouchChat(history.ChatRecord{ChatID: id, GroupID: g.ID, Title: g.Name, Emoji: g.Emoji})
			if summary, err := s.chatSummaryByID(id); err == nil {
				s.emit(Event{Type: "chat_updated", Timestamp: now, Chat: &summary})
			}
		}
	}

	s.stateMu.Lock()
	s.groupKeys = keys
	s.stateMu.Unlock()

	removed := false
	for _, rec := range history.ListChatRecords() {
		if rec.GroupID == 0 && !isGroupChatID(rec.ChatID) {
			continue
		}
		if present[rec.ChatID] {
			continue
		}
		if history.DeleteChat(rec.ChatID) {
			s.stateMu.Lock()
			delete(s.unread, rec.ChatID)
			s.stateMu.Unlock()
			removed = true
		}
	}
	if removed {
		s.emit(Event{Type: "chat_deleted", Timestamp: now})
	}
}

func (s *Service) fetchGroup(ctx context.Context, sess *UserSession, addr string, g protocol.GroupInfo) {
	chatID := groupChatID(g.ID)
	rec, _ := history.GetChatRecord(chatID)
	cursor := rec.Cursor
	live := rec.Synced // пока история не загружена впервые, непрочитанные и уведомления не считаем

	for {
		fctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		items, err := s.node.GroupFetch(fctx, addr, sess.SessionID, g.ID, cursor)
		cancel()
		if err != nil {
			if ctx.Err() == nil {
				fmt.Printf("group %d fetch: %v\n", g.ID, err)
			}
			return
		}
		if len(items) == 0 {
			history.AdvanceGroup(chatID, cursor)
			return
		}
		for _, it := range items {
			if err := s.ingestGroup(sess, g, it.Data, live); err != nil {
				fmt.Printf("group %d: skipping message %d: %v\n", g.ID, it.ID, err)
			}
			cursor = it.ID
		}
		history.AdvanceGroup(chatID, cursor)
	}
}

func (s *Service) ingestGroup(sess *UserSession, g protocol.GroupInfo, raw []byte, live bool) error {
	msg, err := protocol.UnmarshalMessage(raw)
	if err != nil {
		return err
	}
	if err := protocol.ValidateMessage(msg); err != nil {
		return err
	}
	chatID := groupChatID(g.ID)
	gid := strconv.FormatInt(g.ID, 10)
	if msg.Type != protocol.MsgChat || msg.Target != protocol.TargetGroup ||
		msg.TargetID != gid || msg.ChatID != chatID || msg.FromUser == "" {
		return fmt.Errorf("inconsistent group message")
	}
	if history.HasMessage(msg.ID) {
		return nil
	}
	plain, err := corecrypto.UnwrapKey(msg.Payload, g.Key)
	if err != nil {
		return fmt.Errorf("decrypt: %w", err)
	}
	text := string(plain)
	outgoing := msg.FromUser == sess.UserID
	name := s.senderName(sess, msg.FromUser)

	if !history.SaveMessage(history.StoredMessage{
		MessageID: msg.ID,
		ChatID:    chatID,
		TargetID:  msg.TargetID,
		From:      msg.FromUser,
		FromName:  name,
		Text:      text,
		Timestamp: msg.Timestamp,
		Outgoing:  outgoing,
		Strategy:  "group",
	}) {
		return nil
	}
	history.TouchChat(history.ChatRecord{ChatID: chatID, LastMessage: text, LastTimestamp: msg.Timestamp})

	if !live {
		return nil
	}
	direction, event := "incoming", "message_received"
	if outgoing {
		direction, event = "outgoing", "message_sent"
	} else {
		s.stateMu.Lock()
		s.unread[chatID]++
		s.stateMu.Unlock()
	}
	ui := UIMessage{
		MessageID: msg.ID, ChatID: chatID, TargetID: msg.TargetID, From: msg.FromUser, FromName: name,
		Text: text, Timestamp: msg.Timestamp, Direction: direction, Strategy: "group",
	}
	summary, _ := s.chatSummaryByID(chatID)
	s.emit(Event{Type: event, Timestamp: time.Now().UnixMilli(), Message: &ui, Chat: &summary})
	return nil
}

func (s *Service) sendGroupMessage(sess *UserSession, chatID, text string) (UIMessage, error) {
	rec, ok := history.GetChatRecord(chatID)
	if !ok || rec.GroupID == 0 {
		return UIMessage{}, fmt.Errorf("chat not found: %s", chatID)
	}
	s.stateMu.RLock()
	key := s.groupKeys[chatID]
	s.stateMu.RUnlock()
	if len(key) == 0 {
		return UIMessage{}, fmt.Errorf("group key is not available yet, try again in a few seconds")
	}
	payload, err := corecrypto.WrapKey([]byte(text), key)
	if err != nil {
		return UIMessage{}, fmt.Errorf("encrypt message: %w", err)
	}

	msg := protocol.Message{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.MsgChat,
		Target:    protocol.TargetGroup,
		Strategy:  protocol.StrategyRelay,
		TTL:       1,
		TargetID:  strconv.FormatInt(rec.GroupID, 10),
		ChatID:    chatID,
		From:      s.cfg.LocalID,
		FromUser:  sess.UserID,
		Payload:   payload,
		Timestamp: time.Now().UnixMilli(),
	}
	if err := msg.Sign(s.identity.PrivateKey); err != nil {
		return UIMessage{}, err
	}
	raw, err := protocol.MarshalMessage(msg)
	if err != nil {
		return UIMessage{}, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	if err := s.node.GroupSend(ctx, strings.TrimSpace(s.cfg.ServerAddr), sess.SessionID, rec.GroupID, raw); err != nil {
		return UIMessage{}, fmt.Errorf("message could not be delivered: %w", err)
	}

	name := s.ownName(sess)
	history.SaveMessage(history.StoredMessage{
		MessageID: msg.ID, ChatID: chatID, TargetID: msg.TargetID, From: sess.UserID, FromName: name,
		Text: text, Timestamp: msg.Timestamp, Outgoing: true, Strategy: "group",
	})
	history.TouchChat(history.ChatRecord{ChatID: chatID, LastMessage: text, LastTimestamp: msg.Timestamp})

	ui := UIMessage{
		MessageID: msg.ID, ChatID: chatID, TargetID: msg.TargetID, From: sess.UserID, FromName: name,
		Text: text, Timestamp: msg.Timestamp, Direction: "outgoing", Strategy: "group",
	}
	summary, _ := s.chatSummaryByID(chatID)
	s.emit(Event{Type: "message_sent", Timestamp: time.Now().UnixMilli(), Message: &ui, Chat: &summary})
	return ui, nil
}
