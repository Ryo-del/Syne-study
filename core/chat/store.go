// Package chat хранит контакты и чёрный список ТОЛЬКО В ПАМЯТИ. На диск
// ничего не пишется; данные едут на сервер вместе с остальным vault'ом
// (см. Export/Import) и стираются при выходе (Reset).
package chat

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

// Contact — запись адресной книги. Ключ: UserID (логин на сервере), а если
// его нет, PeerID. IP/Port необязательны: у пользователя из каталога сервера
// адреса может не быть.
type Contact struct {
	Name   string `json:"name"`
	PeerID string `json:"peer_id"`
	IP     string `json:"ip"`
	Port   string `json:"port"`
	UserID string `json:"user_id,omitempty"`
}

// Address возвращает "ip:port" или "", если адрес неизвестен.
func (c Contact) Address() string {
	ip := strings.Trim(c.IP, "[]")
	if ip == "" || c.Port == "" {
		return ""
	}
	return net.JoinHostPort(ip, c.Port)
}

type BlockedPeer struct {
	Name    string `json:"name,omitempty"`
	UserID  string `json:"user_id,omitempty"` // новое: ключ блокировки
	PeerID  string `json:"peer_id"`           // справочно
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

// sameIdentity: один и тот же человек. Если у обоих известен UserID, решает
// он (за тем же ПК мог зайти другой аккаунт, поэтому совпадения PeerID мало);
// иначе сравниваем PeerID.
func sameIdentity(a, b Contact) bool {
	if a.UserID != "" && b.UserID != "" {
		return a.UserID == b.UserID
	}
	return a.PeerID != "" && a.PeerID == b.PeerID
}

// IsBlockedUser: заблокирован ли аккаунт.
func IsBlockedUser(userID string) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return false
	}
	mu.RLock()
	defer mu.RUnlock()
	for _, it := range blocked {
		if it.UserID == userID {
			return true
		}
	}
	return false
}

// IsBlocked: только для СТАРЫХ записей без UserID. Запись с UserID устройство
// не блокирует: за тем же ПК может зайти другой аккаунт.
func IsBlocked(peerID string) (bool, error) {
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		return false, fmt.Errorf("peer_id is required")
	}
	mu.RLock()
	defer mu.RUnlock()
	for _, it := range blocked {
		if it.UserID == "" && it.PeerID == peerID {
			return true, nil
		}
	}
	return false, nil
}

// findContactLocked: сначала точное совпадение по UserID/PeerID, потом по имени.
func findContactLocked(query string) int {
	for i := range contacts {
		if (contacts[i].UserID != "" && contacts[i].UserID == query) ||
			(contacts[i].PeerID != "" && contacts[i].PeerID == query) {
			return i
		}
	}
	for i := range contacts {
		if strings.EqualFold(contacts[i].Name, query) {
			return i
		}
	}
	return -1
}

func nameTakenLocked(name string, skip int) bool {
	for i := range contacts {
		if i != skip && strings.EqualFold(contacts[i].Name, name) {
			return true
		}
	}
	return false
}

func tail(s string, n int) string {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
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

// AddContact оставлен для совместимости; см. UpsertContact.
func AddContact(c Contact) error {
	_, err := UpsertContact(c)
	return err
}

// UpsertContact добавляет контакт или обновляет существующий (тот же человек),
// дополняя пустые поля старыми значениями. Возвращает сохранённую запись.
func UpsertContact(c Contact) (Contact, error) {
	c.Name = strings.TrimSpace(c.Name)
	c.PeerID = strings.TrimSpace(c.PeerID)
	c.UserID = strings.TrimSpace(c.UserID)
	c.IP = strings.Trim(strings.TrimSpace(c.IP), "[]")
	c.Port = strings.TrimSpace(c.Port)

	if c.Name == "" {
		return Contact{}, fmt.Errorf("name is required")
	}
	if c.PeerID == "" && c.UserID == "" {
		return Contact{}, fmt.Errorf("peer_id or user_id is required")
	}
	if (c.IP == "") != (c.Port == "") {
		return Contact{}, fmt.Errorf("ip and port must be set together")
	}
	if c.IP != "" {
		if _, err := net.ResolveTCPAddr("tcp", c.Address()); err != nil {
			return Contact{}, fmt.Errorf("invalid contact address: %w", err)
		}
	}

	mu.Lock()
	defer mu.Unlock()

	for i := range contacts {
		if !sameIdentity(contacts[i], c) {
			continue
		}
		old := contacts[i]
		if c.PeerID == "" {
			c.PeerID = old.PeerID
		}
		if c.UserID == "" {
			c.UserID = old.UserID
		}
		if c.IP == "" {
			c.IP, c.Port = old.IP, old.Port
		}
		if nameTakenLocked(c.Name, i) {
			c.Name = old.Name
		}
		contacts[i] = c
		version++
		return c, nil
	}

	// Новый человек с уже занятым именем (например, два "Иван Иванов"):
	// дописываем логин или хвост peer_id, чтобы имя осталось уникальным ключом.
	if nameTakenLocked(c.Name, -1) {
		suffix := c.UserID
		if suffix == "" {
			suffix = tail(c.PeerID, 4)
		}
		c.Name = fmt.Sprintf("%s (%s)", c.Name, suffix)
		if nameTakenLocked(c.Name, -1) {
			return Contact{}, fmt.Errorf("contact name already exists: %s", c.Name)
		}
	}
	contacts = append(contacts, c)
	version++
	return c, nil
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
	if nameTakenLocked(newName, i) {
		return fmt.Errorf("contact name already exists: %s", newName)
	}
	contacts[i].Name = newName
	version++
	return nil
}
func AddBlockedPeer(b BlockedPeer) error {
	b.UserID = strings.TrimSpace(b.UserID)
	b.PeerID = strings.TrimSpace(b.PeerID)
	b.Name = strings.TrimSpace(b.Name)
	b.Reason = strings.TrimSpace(b.Reason)
	if b.UserID == "" && b.PeerID == "" {
		return fmt.Errorf("user_id or peer_id is required")
	}
	if b.AddedAt == 0 {
		b.AddedAt = time.Now().UnixMilli()
	}

	mu.Lock()
	defer mu.Unlock()
	for i := range blocked {
		same := (b.UserID != "" && blocked[i].UserID == b.UserID) ||
			(b.UserID == "" && blocked[i].UserID == "" && blocked[i].PeerID == b.PeerID)
		if !same {
			continue
		}
		if b.Name != "" {
			blocked[i].Name = b.Name
		}
		if b.PeerID != "" {
			blocked[i].PeerID = b.PeerID
		}
		if b.Reason != "" {
			blocked[i].Reason = b.Reason
		}
		version++
		return nil
	}
	blocked = append(blocked, b)
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
		if (blocked[i].UserID != "" && blocked[i].UserID == query) ||
			(blocked[i].PeerID != "" && blocked[i].PeerID == query) ||
			(blocked[i].Name != "" && strings.EqualFold(blocked[i].Name, query)) {
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

// ---------- blocklist ----------

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
		if contacts[i].PeerID == "" {
			return fmt.Errorf("contact has no known device to block: %s", query)
		}
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
