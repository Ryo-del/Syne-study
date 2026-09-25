// Package history хранит переписку ТОЛЬКО В ПАМЯТИ процесса. На диск ничего
// не пишется: после входа данные загружаются с сервера (Import), а перед
// выходом уходят на сервер (Export) и стираются (Reset).
package history

import (
	"encoding/json"
	"sort"
	"strings"
	"sync"
)

type StoredMessage struct {
	MessageID string `json:"message_id"`
	ChatID    string `json:"chat_id"`
	TargetID  string `json:"target_id"`
	From      string `json:"from"` // логин отправителя
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
	Outgoing  bool   `json:"outgoing"`
	Strategy  string `json:"strategy"`
}

type ChatRecord struct {
	ChatID        string `json:"chat_id"`
	PeerID        string `json:"peer_id"`      // последнее известное устройство собеседника
	PeerUserID    string `json:"peer_user_id"` // логин собеседника — настоящий адресат
	Title         string `json:"title"`
	LastMessage   string `json:"last_message"`
	LastTimestamp int64  `json:"last_timestamp"`
}

var (
	mu       sync.RWMutex
	messages = map[string][]StoredMessage{}
	ids      = map[string]struct{}{}
	chats    = map[string]ChatRecord{}
	version  uint64
)

// Version растёт при любом изменении — по нему решаем, нужно ли выгружать на сервер.
func Version() uint64 {
	mu.RLock()
	defer mu.RUnlock()
	return version
}

func resetLocked() {
	messages = map[string][]StoredMessage{}
	ids = map[string]struct{}{}
	chats = map[string]ChatRecord{}
	version++
}

func Reset() {
	mu.Lock()
	defer mu.Unlock()
	resetLocked()
}

func HasMessage(id string) bool {
	mu.RLock()
	defer mu.RUnlock()
	_, ok := ids[id]
	return ok
}

// SaveMessage возвращает false, если такое сообщение уже есть.
func SaveMessage(m StoredMessage) bool {
	mu.Lock()
	defer mu.Unlock()
	if _, exists := ids[m.MessageID]; exists {
		return false
	}
	ids[m.MessageID] = struct{}{}
	list := append(messages[m.ChatID], m)
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Timestamp == list[j].Timestamp {
			return list[i].MessageID < list[j].MessageID
		}
		return list[i].Timestamp < list[j].Timestamp
	})
	messages[m.ChatID] = list
	version++
	return true
}

func LoadMessages(chatID string) []StoredMessage {
	mu.RLock()
	defer mu.RUnlock()
	src := messages[chatID]
	out := make([]StoredMessage, len(src))
	copy(out, src)
	return out
}

func TouchChat(r ChatRecord) {
	r.ChatID = strings.TrimSpace(r.ChatID)
	if r.ChatID == "" {
		return
	}
	r.PeerID = strings.TrimSpace(r.PeerID)
	r.PeerUserID = strings.TrimSpace(r.PeerUserID)
	r.Title = strings.TrimSpace(r.Title)
	r.LastMessage = strings.TrimSpace(r.LastMessage)

	mu.Lock()
	defer mu.Unlock()
	c, ok := chats[r.ChatID]
	if !ok {
		c = ChatRecord{ChatID: r.ChatID}
	}
	if r.PeerID != "" {
		c.PeerID = r.PeerID
	}
	if r.PeerUserID != "" {
		c.PeerUserID = r.PeerUserID
	}
	if r.Title != "" {
		c.Title = r.Title
	}
	if r.LastMessage != "" || r.LastTimestamp > 0 {
		c.LastMessage = r.LastMessage
		c.LastTimestamp = r.LastTimestamp
	}
	chats[r.ChatID] = c
	version++
}

func GetChatRecord(chatID string) (ChatRecord, bool) {
	mu.RLock()
	defer mu.RUnlock()
	c, ok := chats[strings.TrimSpace(chatID)]
	return c, ok
}

func ListChatRecords() []ChatRecord {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]ChatRecord, 0, len(chats))
	for _, c := range chats {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastTimestamp == out[j].LastTimestamp {
			return out[i].ChatID < out[j].ChatID
		}
		return out[i].LastTimestamp > out[j].LastTimestamp
	})
	return out
}

func ClearChatHistory() {
	Reset()
}

type exported struct {
	Messages []StoredMessage `json:"messages"`
	Chats    []ChatRecord    `json:"chats"`
}

func Export() ([]byte, error) {
	mu.RLock()
	defer mu.RUnlock()
	e := exported{Messages: []StoredMessage{}, Chats: []ChatRecord{}}
	for _, list := range messages {
		e.Messages = append(e.Messages, list...)
	}
	for _, c := range chats {
		e.Chats = append(e.Chats, c)
	}
	return json.Marshal(e)
}

func Import(data []byte) error {
	var e exported
	if err := json.Unmarshal(data, &e); err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	resetLocked()
	for _, m := range e.Messages {
		if _, exists := ids[m.MessageID]; exists {
			continue
		}
		ids[m.MessageID] = struct{}{}
		messages[m.ChatID] = append(messages[m.ChatID], m)
	}
	for chatID, list := range messages {
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].Timestamp == list[j].Timestamp {
				return list[i].MessageID < list[j].MessageID
			}
			return list[i].Timestamp < list[j].Timestamp
		})
		messages[chatID] = list
	}
	for _, c := range e.Chats {
		chats[c.ChatID] = c
	}
	return nil
}
