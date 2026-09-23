package p2p

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	mdns "github.com/libp2p/go-libp2p/p2p/discovery/mdns"
)

// studyServerMDNSService — отдельное mDNS-имя, на котором анонсирует себя
// только study-сервер. Оно намеренно отличается от общего P2P-имени
// (mdnsServiceName), которое используется для обнаружения обычных
// собеседников — поэтому найденный здесь сервер никогда не попадёт
// в список "nearby"/чатов, и наоборот.
// ВАЖНО: эта строка должна дословно совпадать со строкой в
// server/cmd/syne-server/main.go.
const studyServerMDNSService = "_syne-study-server._tcp"

type serverDiscoveryNotifee struct {
	mu     sync.Mutex
	found  chan peer.AddrInfo
	closed bool
}

func (n *serverDiscoveryNotifee) HandlePeerFound(info peer.AddrInfo) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return
	}
	select {
	case n.found <- info:
	default:
		// Канал уже получил кандидата — этого достаточно, лишние сбрасываем.
	}
}

// DiscoverStudyServer слушает LAN-сегмент до timeout и возвращает multiaddr
// первого найденного study-сервера. Это способ по умолчанию находить сервер
// без ручного ввода адреса — работает, пока клиент и сервер в одной
// локальной сети (mDNS не проходит через роутеры). Если за timeout никто не
// откликнулся, вызывающий код должен откатиться на вручную заданный адрес
// (флаг, файл конфигурации) — это единственный сценарий, где ручной ввод
// всё ещё нужен: сервер в другой подсети или за интернетом.
func (n *Node) DiscoverStudyServer(ctx context.Context, timeout time.Duration) (string, error) {
	notifee := &serverDiscoveryNotifee{found: make(chan peer.AddrInfo, 4)}

	service := mdns.NewMdnsService(n.host, studyServerMDNSService, notifee)
	if err := service.Start(); err != nil {
		return "", fmt.Errorf("start study server discovery: %w", err)
	}
	defer func() {
		notifee.mu.Lock()
		notifee.closed = true
		notifee.mu.Unlock()
		_ = service.Close()
	}()

	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case info := <-notifee.found:
		addrs, err := peer.AddrInfoToP2pAddrs(&info)
		if err != nil || len(addrs) == 0 {
			return "", fmt.Errorf("study server found but has no usable address")
		}
		return addrs[0].String(), nil
	case <-timeoutCtx.Done():
		return "", fmt.Errorf("no study server found on the local network within %s", timeout)
	}
}
