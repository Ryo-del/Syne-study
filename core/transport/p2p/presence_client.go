package p2p

import (
	"context"
	"log/slog"

	protocol "github.com/Ryo-del/Syne-protocol"
)

// StartPresence сообщает study-серверу, что этот пользователь в сети
// (login, свой PeerID и имя — чтобы остальные могли увидеть его
// в nearby-списке и сразу открыть чат по PeerID), получает список уже
// online-пользователей и слушает обновления (кто-то зашёл/вышел).
func (n *Node) StartPresence(
	ctx context.Context,
	serverAddr string,
	userID string,
	fname string,
	sname string,
	onSnapshot func(users []protocol.PresenceUser),
	onUpdate func(user protocol.PresenceUser, status string),
) error {
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
		PeerID: n.ID(),
		FName:  fname,
		SName:  sname,
	}
	data, err := protocol.MarshalJSON(msg)
	if err != nil {
		return err
	}

	if err := protocol.WriteFramedMessage(stream, data); err != nil {
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
			onUpdate(update.User, update.Status)
		}
	}()
	return nil
}
