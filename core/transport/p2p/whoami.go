package p2p

import (
	"context"
	"fmt"
	"io"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
)

// SessionProvider — минимальный интерфейс, чтобы whoami.go не тянул
// весь пакет app и не создавал циклическую зависимость.
type SessionProvider interface {
	CurrentUserInfo() (userID, fname, sname string, ok bool)
	CurrentIdentityPublicKey() ([]byte, bool)
}

func peerIDFromString(s string) (peer.ID, error) {
	return peer.Decode(s)
}

func (n *Node) SetWhoAmIHandler(provider SessionProvider) {
	n.host.SetStreamHandler(protocol.WhoAmIStreamProtocol, func(stream network.Stream) {
		defer stream.Close()
		_ = stream.SetReadDeadline(time.Now().Add(protocol.DefaultReadDeadline))

		_, err := io.ReadAll(io.LimitReader(stream, protocol.DefaultReadLimit))
		if err != nil {
			return
		}

		userID, fname, sname, ok := provider.CurrentUserInfo()
		if !ok {
			return // никто не залогинен — отвечать нечего, просто закрываем stream
		}

		resp := protocol.WhoAmIResponse{
			Type:   protocol.WhoAmITypeResponse,
			UserID: userID,
			FName:  fname,
			SName:  sname,
		}
		data, err := protocol.MarshalJSON(resp)
		if err != nil {
			return
		}
		_ = stream.SetWriteDeadline(time.Now().Add(protocol.DefaultReadDeadline))
		_, _ = stream.Write(data)
	})
}

// WhoAmI спрашивает у собеседника его пользовательские данные (login, имя,
// фамилию). Раньше функция сразу открывала stream через n.host.NewStream —
// это требует уже установленного соединения. Если с собеседником ещё не
// было прямого обмена пакетами (первый контакт — типичный случай, когда
// его только что нашли через mDNS/presence), NewStream падал с ошибкой,
// и WhoAmI молча проваливался — поэтому в UI вместо имени показывался
// сырой PeerID. Теперь сначала резолвим адрес тем же путём, что и обычная
// отправка сообщений (ResolvePeer: кэш → Peerstore → DHT), и явно
// подключаемся перед открытием stream — как это уже делает send() в node.go.
func (n *Node) WhoAmI(ctx context.Context, targetID string) (*protocol.WhoAmIResponse, error) {
	info, err := n.ResolvePeer(ctx, targetID)
	if err != nil {
		return nil, fmt.Errorf("resolve peer %s: %w", targetID, err)
	}

	n.host.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
	if err := n.host.Connect(ctx, info); err != nil {
		return nil, fmt.Errorf("connect to peer %s: %w", targetID, err)
	}

	stream, err := n.host.NewStream(ctx, info.ID, protocol.WhoAmIStreamProtocol)
	if err != nil {
		return nil, fmt.Errorf("open whoami stream: %w", err)
	}
	defer stream.Close()

	req := protocol.WhoAmIRequest{Type: protocol.WhoAmITypeRequest}
	data, err := protocol.MarshalJSON(req)
	if err != nil {
		return nil, fmt.Errorf("marshal whoami request: %w", err)
	}
	_, err = stream.Write(data)
	if err != nil {
		return nil, fmt.Errorf("send whoami request: %w", err)
	}
	if err := stream.CloseWrite(); err != nil {
		return nil, fmt.Errorf("close write side: %w", err)
	}

	respData, err := io.ReadAll(io.LimitReader(stream, protocol.DefaultReadLimit))
	if err != nil {
		return nil, fmt.Errorf("read whoami response: %w", err)
	}

	resp, err := protocol.UnmarshalJSON[protocol.WhoAmIResponse](respData)
	if err != nil {
		return nil, fmt.Errorf("parse whoami response: %w", err)
	}
	return &resp, nil
}
