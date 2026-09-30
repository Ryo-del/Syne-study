package p2p

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
)

// ВАЖНО: должно дословно совпадать с directory.ProtocolID на сервере.
const directoryProtocol = protocol.ID("/syne/directory/1.0.0")

type DirectoryUser struct {
	Login  string `json:"login"`
	FName  string `json:"fname"`
	SName  string `json:"sname"`
	Role   string `json:"role"`
	PeerID string `json:"peer_id"` // заполняет Service из presence
	Online bool   `json:"online"`  // заполняет Service из presence
}

func (n *Node) Directory(ctx context.Context, serverAddr, sessionID, query string, limit int) ([]DirectoryUser, error) {
	info, err := peer.AddrInfoFromString(serverAddr)
	if err != nil {
		return nil, fmt.Errorf("bad server address: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	h := n.host // ← единственное место под твой Node: поле с libp2p host.Host
	if h.Network().Connectedness(info.ID) != network.Connected {
		if err := h.Connect(ctx, *info); err != nil {
			return nil, fmt.Errorf("connect to server: %w", err)
		}
	}
	s, err := h.NewStream(ctx, info.ID, directoryProtocol)
	if err != nil {
		return nil, fmt.Errorf("open stream: %w", err)
	}
	defer s.Close()
	_ = s.SetDeadline(time.Now().Add(10 * time.Second))

	req := struct {
		SessionID string `json:"session_id"`
		Query     string `json:"query"`
		Limit     int    `json:"limit"`
	}{sessionID, query, limit}
	if err := json.NewEncoder(s).Encode(req); err != nil {
		return nil, err
	}
	_ = s.CloseWrite()

	var resp struct {
		Users []DirectoryUser `json:"users"`
		Error string          `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(s, 1<<20)).Decode(&resp); err != nil {
		return nil, err
	}
	if resp.Error != "" {
		return nil, errors.New(resp.Error)
	}
	if resp.Users == nil {
		resp.Users = []DirectoryUser{}
	}
	return resp.Users, nil
}
