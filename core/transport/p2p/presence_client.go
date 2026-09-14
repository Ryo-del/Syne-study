package p2p

import (
	"context"
	"log/slog"

	protocol "github.com/Ryo-del/Syne-protocol"
)

func (n *Node) StartPresence(ctx context.Context, serverAddr string, userID string, onSnapshot func(online []string), onUpdate func(userID, status string)) error {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return err
	}
	stream, err := n.host.NewStream(ctx, serverID, protocol.PresenceStreamProtocol)
	if err != nil {
		return err
	}
	msg := protocol.PresenceOnline{
		Type:   protocol.PresenceTypeOnline,
		UserID: userID,
	}
	data, err := protocol.MarshalJSON(msg)
	if err != nil {
		return err
	}

	err = protocol.WriteFramedMessage(stream, data)
	if err != nil {
		return err
	}
	data, err = protocol.ReadFramedMessage(stream)
	if err != nil {
		return err
	}
	snapshot, err := protocol.UnmarshalJSON[protocol.PresenceSnapshot](data)
	if err != nil {
		return err
	}

	onSnapshot(snapshot.Users)
	go func() {
		<-ctx.Done()
		_ = stream.Close()
	}()
	go func() {
		for {
			data, err := protocol.ReadFramedMessage(stream)
			if err != nil {
				slog.Error("presence connection lost", "error", err)
				return
			}
			update, err := protocol.UnmarshalJSON[protocol.PresenceUpdate](data)
			if err != nil {
				continue // одно повреждённое сообщение не должно рвать весь цикл — просто пропускаем
			}
			onUpdate(update.UserID, update.Status)
		}
	}()
	return nil
}
