package p2p

import (
	"context"
	"fmt"

	"Syne/core/crypto"

	protocol "github.com/Ryo-del/Syne-protocol"
)

func (n *Node) ChangePassword(ctx context.Context, serverAddr, sessionID, currentPassword, newPassword string, masterKey, identityPrivateKey, identityPublicKey []byte) error {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return err
	}
	stream, err := n.host.NewStream(ctx, serverID, protocol.AuthStreamProtocol)
	if err != nil {
		return fmt.Errorf("open password change stream: %w", err)
	}
	defer stream.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = stream.SetDeadline(deadline)
	}

	request, err := protocol.MarshalJSON(protocol.PasswordChangeRequest{Type: protocol.AuthTypePasswordChangeRequest, SessionID: sessionID})
	if err != nil {
		return err
	}
	if err := protocol.WriteFramedMessage(stream, request); err != nil {
		return fmt.Errorf("send password change request: %w", err)
	}
	challengeData, err := protocol.ReadFramedMessage(stream)
	if err != nil {
		return fmt.Errorf("read password change challenge: %w", err)
	}
	challengeType, err := protocol.PeekType(challengeData)
	if err != nil {
		return err
	}
	if challengeType == protocol.AuthTypePasswordChangeResult {
		result, _ := protocol.UnmarshalJSON[protocol.PasswordChangeResult](challengeData)
		return fmt.Errorf("%s", result.Reason)
	}
	challenge, err := protocol.UnmarshalJSON[protocol.PasswordChangeChallenge](challengeData)
	if err != nil || challenge.Type != protocol.AuthTypePasswordChangeChallenge {
		return fmt.Errorf("invalid password change challenge")
	}

	currentHash := crypto.DerivePasswordHash(currentPassword, challenge.PasswordSalt)
	newPasswordSalt, err := crypto.GenerateSalt()
	if err != nil {
		return fmt.Errorf("generate new password salt: %w", err)
	}
	newLoginKeySalt, err := crypto.GenerateSalt()
	if err != nil {
		return fmt.Errorf("generate new login key salt: %w", err)
	}
	newLoginKey := crypto.DeriveLoginKey(newPassword, newLoginKeySalt)
	newPasswordHash := crypto.DerivePasswordHash(newPassword, newPasswordSalt)
	encryptedMasterKey, err := crypto.WrapKey(masterKey, newLoginKey)
	if err != nil {
		return fmt.Errorf("rewrap master key: %w", err)
	}
	encryptedIdentityKey, err := crypto.WrapKey(identityPrivateKey, newLoginKey)
	if err != nil {
		return fmt.Errorf("rewrap identity key: %w", err)
	}
	verify, err := protocol.MarshalJSON(protocol.PasswordChangeVerify{
		Type: protocol.AuthTypePasswordChangeVerify, SessionID: sessionID,
		CurrentPasswordHash: currentHash, PasswordHash: newPasswordHash,
		PasswordSalt: newPasswordSalt, LoginKeySalt: newLoginKeySalt,
		EncryptedMasterKey: encryptedMasterKey, IdentityPublicKey: identityPublicKey,
		EncryptedIdentityKey: encryptedIdentityKey,
	})
	if err != nil {
		return err
	}
	if err := protocol.WriteFramedMessage(stream, verify); err != nil {
		return fmt.Errorf("send password change proof: %w", err)
	}
	resultData, err := protocol.ReadFramedMessage(stream)
	if err != nil {
		return fmt.Errorf("read password change result: %w", err)
	}
	result, err := protocol.UnmarshalJSON[protocol.PasswordChangeResult](resultData)
	if err != nil {
		return err
	}
	if !result.OK {
		return fmt.Errorf("%s", result.Reason)
	}
	return nil
}
