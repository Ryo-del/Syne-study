package p2p

import (
	"context"
	"fmt"
	"io"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peerstore"
)

func (n *Node) SetIdentityKeyHandler(provider SessionProvider) {
	n.host.SetStreamHandler(protocol.IdentityKeyStreamProtocol, func(stream network.Stream) {
		defer stream.Close()
		_ = stream.SetReadDeadline(time.Now().Add(protocol.DefaultReadDeadline))

		_, err := io.ReadAll(io.LimitReader(stream, protocol.DefaultReadLimit))
		if err != nil {
			return
		}

		publicKey, ok := provider.CurrentIdentityPublicKey()
		if !ok {
			return
		}

		resp := protocol.GetIdentityKeyResponse{
			Type:              protocol.IdentityKeyTypeResponse,
			IdentityPublicKey: publicKey,
		}
		data, err := protocol.MarshalJSON(resp)
		if err != nil {
			return
		}
		_ = stream.SetWriteDeadline(time.Now().Add(protocol.DefaultReadDeadline))
		_, _ = stream.Write(data)
	})
}

// GetIdentityKey запрашивает у собеседника его X25519 identity-ключ,
// нужный для вычисления общего ключа чата (DeriveChatKey в service.go).
// Та же проблема, что и в WhoAmI (см. whoami.go): функция сразу открывала
// stream без предварительного подключения. Если с собеседником ещё не
// было прямого соединения — запрос падал, deriveChatKeyWith возвращал
// ошибку, и SendMessage прерывался ДО вызова history.SaveMessage — то
// есть сообщение не отправлялось и не сохранялось локально. То же самое
// происходило и на стороне получателя при попытке расшифровать входящее
// сообщение (handlePacket тоже вызывает deriveChatKeyWith), поэтому
// сообщения пропадали в обе стороны. Теперь сначала резолвим адрес и
// подключаемся, как при обычной отправке.
func (n *Node) GetIdentityKey(ctx context.Context, targetID string) (*protocol.GetIdentityKeyResponse, error) {
	info, err := n.ResolvePeer(ctx, targetID)
	if err != nil {
		return nil, fmt.Errorf("resolve peer %s: %w", targetID, err)
	}

	n.host.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
	if err := n.host.Connect(ctx, info); err != nil {
		return nil, fmt.Errorf("connect to peer %s: %w", targetID, err)
	}

	stream, err := n.host.NewStream(ctx, info.ID, protocol.IdentityKeyStreamProtocol)
	if err != nil {
		return nil, fmt.Errorf("open identity key stream: %w", err)
	}
	defer stream.Close()

	req := protocol.GetIdentityKeyRequest{Type: protocol.IdentityKeyTypeRequest}
	data, err := protocol.MarshalJSON(req)
	if err != nil {
		return nil, fmt.Errorf("marshal identity key request: %w", err)
	}
	if _, err := stream.Write(data); err != nil {
		return nil, fmt.Errorf("send identity key request: %w", err)
	}
	if err := stream.CloseWrite(); err != nil {
		return nil, fmt.Errorf("close write side: %w", err)
	}

	respData, err := io.ReadAll(io.LimitReader(stream, protocol.DefaultReadLimit))
	if err != nil {
		return nil, fmt.Errorf("read identity key response: %w", err)
	}

	resp, err := protocol.UnmarshalJSON[protocol.GetIdentityKeyResponse](respData)
	if err != nil {
		return nil, fmt.Errorf("parse identity key response: %w", err)
	}
	return &resp, nil
}
