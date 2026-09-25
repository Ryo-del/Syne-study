// Package chat хранит контакты и чёрный список ТОЛЬКО В ПАМЯТИ. На диск
// ничего не пишется; данные едут на сервер вместе с остальным vault'ом
// (см. Export/Import) и стираются при выходе (Reset).
//
// Замените этим файлом chat.go и blocklist.go; chat_test.go (тесты на файлы)
// нужно удалить или переписать.
package chat

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

type Contact struct {
	Name   string `json:"name"`
	PeerID string `json:"peer_id"`
	IP     string `json:"ip"`
	Port   string `json:"port"`
}

func (c Contact) Address() string {
	ip := strings.Trim(c.IP, "[]")
	return net.JoinHostPort(ip, c.Port)
}

type BlockedPeer struct {
	Name    string `json:"name,omitempty"`
	PeerID  string `json:"peer_id"`
	AddedAt int64  `json:"added_at"`
	Reason  string `json:"reason,omitempty"`
}

var (
	mu       sync.RWMutex
	contacts []Contact
	blocked  []BlockedPeer
	version  uint64
)

func Version() uint64 {
	mu.RLock()
	defer mu.RUnlock()
	return version
}

func Reset() {
	mu.Lock()
	defer mu.Unlock()
	contacts = nil
	blocked = nil
	version++
}

// ---------- contacts ----------

func findContactLocked(query string) int {
	for i := range contacts {
		if contacts[i].PeerID == query || strings.EqualFold(contacts[i].Name, query) {
			return i
		}
	}
	return -1
}

func ListContacts() ([]Contact, error) {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Contact, len(contacts))
	copy(out, contacts)
	return out, nil
}

func FindContact(query string) (Contact, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return Contact{}, fmt.Errorf("query is required")
	}
	mu.RLock()
	defer mu.RUnlock()
	if i := findContactLocked(query); i >= 0 {
		return contacts[i], nil
	}
	return Contact{}, fmt.Errorf("contact not found: %s", query)
}

func AddContact(c Contact) error {
	c.Name = strings.TrimSpace(c.Name)
	c.PeerID = strings.TrimSpace(c.PeerID)
	c.IP = strings.Trim(strings.TrimSpace(c.IP), "[]")
	c.Port = strings.TrimSpace(c.Port)
	if c.Name == "" || c.PeerID == "" || c.IP == "" || c.Port == "" {
		return fmt.Errorf("name, peer_id, ip and port are required")
	}
	if _, err := net.ResolveTCPAddr("tcp", c.Address()); err != nil {
		return fmt.Errorf("invalid contact address: %w", err)
	}

	mu.Lock()
	defer mu.Unlock()
	for i := range contacts {
		if contacts[i].PeerID == c.PeerID || strings.EqualFold(contacts[i].Name, c.Name) {
			contacts[i] = c
			version++
			return nil
		}
	}
	contacts = append(contacts, c)
	version++
	return nil
}

func DeleteContact(query string) error {
	query = strings.TrimSpace(query)
	if query == "" {
		return fmt.Errorf("query is required")
	}
	mu.Lock()
	defer mu.Unlock()
	i := findContactLocked(query)
	if i < 0 {
		return fmt.Errorf("contact not found: %s", query)
	}
	contacts = append(contacts[:i], contacts[i+1:]...)
	version++
	return nil
}

func RenameContact(query, newName string) error {
	query = strings.TrimSpace(query)
	newName = strings.TrimSpace(newName)
	if query == "" || newName == "" {
		return fmt.Errorf("query and new-name are required")
	}
	mu.Lock()
	defer mu.Unlock()
	i := findContactLocked(query)
	if i < 0 {
		return fmt.Errorf("contact not found: %s", query)
	}
	for j := range contacts {
		if j != i && strings.EqualFold(contacts[j].Name, newName) {
			return fmt.Errorf("contact name already exists: %s", newName)
		}
	}
	contacts[i].Name = newName
	version++
	return nil
}

// ---------- blocklist ----------

func IsBlocked(peerID string) (bool, error) {
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		return false, fmt.Errorf("peer_id is required")
	}
	mu.RLock()
	defer mu.RUnlock()
	for _, it := range blocked {
		if it.PeerID == peerID {
			return true, nil
		}
	}
	return false, nil
}

func AddBlocked(query, reason string) error {
	query = strings.TrimSpace(query)
	reason = strings.TrimSpace(reason)
	if query == "" {
		return fmt.Errorf("query is required")
	}

	mu.Lock()
	defer mu.Unlock()

	peerID, name := query, ""
	if i := findContactLocked(query); i >= 0 {
		peerID, name = contacts[i].PeerID, contacts[i].Name
	}
	for i := range blocked {
		if blocked[i].PeerID == peerID {
			if name != "" {
				blocked[i].Name = name
			}
			if reason != "" {
				blocked[i].Reason = reason
			}
			version++
			return nil
		}
	}
	blocked = append(blocked, BlockedPeer{
		Name:    name,
		PeerID:  peerID,
		AddedAt: time.Now().UnixMilli(),
		Reason:  reason,
	})
	version++
	return nil
}

func RemoveBlocked(query string) error {
	query = strings.TrimSpace(query)
	if query == "" {
		return fmt.Errorf("query is required")
	}
	mu.Lock()
	defer mu.Unlock()
	for i := range blocked {
		if blocked[i].PeerID == query || (blocked[i].Name != "" && strings.EqualFold(blocked[i].Name, query)) {
			blocked = append(blocked[:i], blocked[i+1:]...)
			version++
			return nil
		}
	}
	return fmt.Errorf("blocked peer not found: %s", query)
}

func ListBlocked() ([]BlockedPeer, error) {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]BlockedPeer, len(blocked))
	copy(out, blocked)
	return out, nil
}

// ---------- vault ----------

type exported struct {
	Contacts []Contact     `json:"contacts"`
	Blocked  []BlockedPeer `json:"blocked"`
}

func Export() ([]byte, error) {
	mu.RLock()
	defer mu.RUnlock()
	e := exported{Contacts: contacts, Blocked: blocked}
	if e.Contacts == nil {
		e.Contacts = []Contact{}
	}
	if e.Blocked == nil {
		e.Blocked = []BlockedPeer{}
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
	contacts = e.Contacts
	blocked = e.Blocked
	version++
	return nil
}
