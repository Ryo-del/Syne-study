package p2p

import (
	"context"
	"errors"
	"fmt"

	protocol "github.com/Ryo-del/Syne-protocol"
)

func (n *Node) syncCall(ctx context.Context, serverAddr string, req protocol.SyncRequest) (*protocol.SyncResponse, error) {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return nil, err
	}
	stream, err := n.host.NewStream(ctx, serverID, protocol.SyncStreamProtocol)
	if err != nil {
		return nil, fmt.Errorf("open sync stream: %w", err)
	}
	defer stream.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = stream.SetDeadline(dl)
	}

	data, err := protocol.MarshalJSON(req)
	if err != nil {
		return nil, err
	}
	if err := protocol.WriteFramedMessage(stream, data); err != nil {
		return nil, fmt.Errorf("send sync request: %w", err)
	}
	respData, err := protocol.ReadFramedMessageMax(stream, protocol.SyncMaxFrame)
	if err != nil {
		return nil, fmt.Errorf("read sync response: %w", err)
	}
	resp, err := protocol.UnmarshalJSON[protocol.SyncResponse](respData)
	if err != nil {
		return nil, fmt.Errorf("parse sync response: %w", err)
	}
	if !resp.OK {
		return nil, errors.New(resp.Error)
	}
	return &resp, nil
}

func (n *Node) VaultGet(ctx context.Context, serverAddr, sessionID string) ([]byte, bool, error) {
	resp, err := n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpVaultGet, SessionID: sessionID})
	if err != nil {
		return nil, false, err
	}
	return resp.Data, resp.Exists, nil
}

func (n *Node) VaultPut(ctx context.Context, serverAddr, sessionID string, data []byte) error {
	_, err := n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpVaultPut, SessionID: sessionID, Data: data})
	return err
}

func (n *Node) KeyLookup(ctx context.Context, serverAddr, sessionID, userID string) (*protocol.SyncResponse, error) {
	return n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpKeyLookup, SessionID: sessionID, UserID: userID})
}

func (n *Node) MailboxPush(ctx context.Context, serverAddr, sessionID, toUser string, data []byte) error {
	_, err := n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpMailboxPush, SessionID: sessionID, UserID: toUser, Data: data})
	return err
}

func (n *Node) MailboxFetch(ctx context.Context, serverAddr, sessionID string) ([]protocol.MailboxItem, error) {
	resp, err := n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpMailboxFetch, SessionID: sessionID})
	if err != nil {
		return nil, err
	}
	return resp.Items, nil
}

func (n *Node) MailboxAck(ctx context.Context, serverAddr, sessionID string, ids []int64) error {
	_, err := n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpMailboxAck, SessionID: sessionID, IDs: ids})
	return err
}

func (n *Node) SyncLogout(ctx context.Context, serverAddr, sessionID string) error {
	_, err := n.syncCall(ctx, serverAddr, protocol.SyncRequest{Type: protocol.SyncOpLogout, SessionID: sessionID})
	return err
}
