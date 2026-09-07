package p2p

import (
	"context"
	"fmt"
	"io"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p/core/peer"
	lpprotocol "github.com/libp2p/go-libp2p/core/protocol"
	ma "github.com/multiformats/go-multiaddr"
)

func (n *Node) ConnectToServer(ctx context.Context, serverAddr string) (*protocol.Welcome, error) {
	maddr, err := ma.NewMultiaddr(serverAddr)
	if err != nil {
		return nil, err
	}
	info, err := peer.AddrInfoFromP2pAddr(maddr)
	if err != nil {
		return nil, err
	}
	if err := n.host.Connect(ctx, *info); err != nil {
		return nil, err
	}
	stream, err := n.host.NewStream(
		ctx,
		info.ID,
		lpprotocol.ID(protocol.StreamProtocol),
	)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	hello := protocol.Hello{
		PeerID:          n.host.ID().String(),
		ProtocolVersion: protocol.ProtocolVersion,
		Timestamp:       time.Now().UnixMilli(),
	}
	data, err := protocol.MarshalHello(hello)
	if err != nil {
		return nil, err
	}
	_, err = stream.Write(data)
	if err != nil {
		return nil, err
	}
	_ = stream.SetReadDeadline(time.Now().Add(protocol.DefaultReadDeadline))
	respData, err := io.ReadAll(io.LimitReader(stream, protocol.DefaultReadLimit))
	if err != nil {
		return nil, err
	}

	controlType, err := protocol.PeekControlType(respData)
	if err != nil {
		return nil, err
	}

	switch controlType {
	case protocol.ControlTypeWelcome:
		welcome, err := protocol.UnmarshalWelcome(respData)
		if err != nil {
			return nil, err
		}
		return &welcome, nil
	case protocol.ControlTypeReject:
		reject, err := protocol.UnmarshalReject(respData)
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("server rejected connection: %s", reject.Reason)
	default:
		return nil, fmt.Errorf("unexpected control type: %s", controlType)
	}
}
