package p2p

import (
	"context"
	"crypto/rand"
	"fmt"

	"Syne/core/crypto"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

type LoginResult struct {
	SessionID          string
	MasterKey          []byte
	IdentityPrivateKey []byte
	IdentityPublicKey  []byte
	FName              string
	SName              string
}

func (n *Node) dialServer(ctx context.Context, serverAddr string) (peer.ID, error) {
	addr, err := multiaddr.NewMultiaddr(serverAddr)
	if err != nil {
		return "", fmt.Errorf("parse server address: %w", err)
	}

	info, err := peer.AddrInfoFromP2pAddr(addr)
	if err != nil {
		return "", fmt.Errorf("parse peer address: %w", err)
	}

	if err := n.host.Connect(ctx, *info); err != nil {
		return "", fmt.Errorf("connect to server: %w", err)
	}

	return info.ID, nil
}

func (n *Node) Register(
	ctx context.Context,
	serverAddr string,
	login, fname, sname, password string,
) ([]byte, error) {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return nil, err
	}

	stream, err := n.host.NewStream(
		ctx,
		serverID,
		protocol.AuthStreamProtocol,
	)
	if err != nil {
		return nil, fmt.Errorf("open auth stream: %w", err)
	}
	defer stream.Close()

	passwordSalt, err := crypto.GenerateSalt()
	if err != nil {
		return nil, fmt.Errorf("generate password salt: %w", err)
	}

	loginKeySalt, err := crypto.GenerateSalt()
	if err != nil {
		return nil, fmt.Errorf("generate login key salt: %w", err)
	}

	passwordHash := crypto.DerivePasswordHash(password, passwordSalt)
	loginKey := crypto.DeriveLoginKey(password, loginKeySalt)

	masterKey := make([]byte, crypto.SharedKeySize)

	if _, err := rand.Read(masterKey); err != nil {
		return nil, fmt.Errorf("generate master key: %w", err)
	}
	identityKey, err := crypto.GenerateIdentityKeyPair()
	if err != nil {
		return nil, fmt.Errorf("generate identity key pair: %w", err)
	}

	identityPublicKey := identityKey.PublicKey().Bytes()
	identityPrivateKeyBytes := identityKey.Bytes()
	encryptedIdentityKey, err := crypto.WrapKey(identityPrivateKeyBytes, loginKey)
	if err != nil {
		return nil, fmt.Errorf("wrap identity key: %w", err)
	}
	encryptedMasterKey, err := crypto.WrapKey(masterKey, loginKey)
	if err != nil {
		return nil, fmt.Errorf("wrap master key: %w", err)
	}

	request := protocol.RegisterRequest{
		Type:                 protocol.AuthTypeRegisterRequest,
		Login:                login,
		FName:                fname,
		SName:                sname,
		PasswordHash:         passwordHash,
		PasswordSalt:         passwordSalt,
		LoginKeySalt:         loginKeySalt,
		EncryptedMasterKey:   encryptedMasterKey,
		IdentityPublicKey:    identityPublicKey,
		EncryptedIdentityKey: encryptedIdentityKey,
	}

	data, err := protocol.MarshalJSON(request)
	if err != nil {
		return nil, fmt.Errorf("marshal register request: %w", err)
	}

	if err := protocol.WriteFramedMessage(stream, data); err != nil {
		return nil, fmt.Errorf("send register request: %w", err)
	}

	responseData, err := protocol.ReadFramedMessage(stream)
	if err != nil {
		return nil, fmt.Errorf("read register response: %w", err)
	}

	responseType, err := protocol.PeekType(responseData)
	if err != nil {
		return nil, fmt.Errorf("read register response type: %w", err)
	}

	switch responseType {
	case protocol.AuthTypeRegisterSuccess:
		return masterKey, nil

	case protocol.AuthTypeRegisterFailure:
		failure, err := protocol.UnmarshalJSON[protocol.RegisterFailure](responseData)
		if err != nil {
			return nil, fmt.Errorf("parse register failure: %w", err)
		}

		return nil, fmt.Errorf("registration failed: %s", failure.Reason)

	default:
		return nil, fmt.Errorf(
			"unexpected register response type: %s",
			responseType,
		)
	}
}

func (n *Node) Login(
	ctx context.Context,
	serverAddr string,
	login, password string,
) (*LoginResult, error) {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return nil, err
	}

	stream, err := n.host.NewStream(
		ctx,
		serverID,
		protocol.AuthStreamProtocol,
	)
	if err != nil {
		return nil, fmt.Errorf("open auth stream: %w", err)
	}
	defer stream.Close()

	request := protocol.LoginRequest{
		Type:  protocol.AuthTypeLoginRequest,
		Login: login,
	}

	data, err := protocol.MarshalJSON(request)
	if err != nil {
		return nil, fmt.Errorf("marshal login request: %w", err)
	}

	if err := protocol.WriteFramedMessage(stream, data); err != nil {
		return nil, fmt.Errorf("send login request: %w", err)
	}

	challengeData, err := protocol.ReadFramedMessage(stream)
	if err != nil {
		return nil, fmt.Errorf("read login challenge: %w", err)
	}

	responseType, err := protocol.PeekType(challengeData)
	if err != nil {
		return nil, fmt.Errorf("read login response type: %w", err)
	}

	switch responseType {
	case protocol.AuthTypeLoginFailure:
		failure, err := protocol.UnmarshalJSON[protocol.LoginFailure](challengeData)
		if err != nil {
			return nil, fmt.Errorf("parse login failure: %w", err)
		}

		return nil, fmt.Errorf("login failed: %s", failure.Reason)

	case protocol.AuthTypeLoginChallenge:
		// Continue authentication.

	default:
		return nil, fmt.Errorf(
			"unexpected login response type: %s",
			responseType,
		)
	}

	challenge, err := protocol.UnmarshalJSON[protocol.LoginChallenge](challengeData)
	if err != nil {
		return nil, fmt.Errorf("parse login challenge: %w", err)
	}

	passwordHash := crypto.DerivePasswordHash(
		password,
		challenge.PasswordSalt,
	)

	loginKey := crypto.DeriveLoginKey(
		password,
		challenge.LoginKeySalt,
	)

	verify := protocol.LoginVerify{
		Type:         protocol.AuthTypeLoginVerify,
		Login:        login,
		PasswordHash: passwordHash,
	}

	verifyData, err := protocol.MarshalJSON(verify)
	if err != nil {
		return nil, fmt.Errorf("marshal login verify: %w", err)
	}

	if err := protocol.WriteFramedMessage(stream, verifyData); err != nil {
		return nil, fmt.Errorf("send login verify: %w", err)
	}

	resultData, err := protocol.ReadFramedMessage(stream)
	if err != nil {
		return nil, fmt.Errorf("read login result: %w", err)
	}

	resultType, err := protocol.PeekType(resultData)
	if err != nil {
		return nil, fmt.Errorf("read login result type: %w", err)
	}

	switch resultType {
	case protocol.AuthTypeLoginFailure:
		failure, err := protocol.UnmarshalJSON[protocol.LoginFailure](resultData)
		if err != nil {
			return nil, fmt.Errorf("parse login failure: %w", err)
		}

		return nil, fmt.Errorf("login failed: %s", failure.Reason)

	case protocol.AuthTypeLoginSuccess:
		// Continue below.

	default:
		return nil, fmt.Errorf(
			"unexpected login result type: %s",
			resultType,
		)
	}

	success, err := protocol.UnmarshalJSON[protocol.LoginSuccess](resultData)
	if err != nil {
		return nil, fmt.Errorf("parse login success: %w", err)
	}

	masterKey, err := crypto.UnwrapKey(
		success.EncryptedMasterKey,
		loginKey,
	)
	if err != nil {
		return nil, fmt.Errorf("unwrap master key: %w", err)
	}
	identityPrivateKeyBytes, err := crypto.UnwrapKey(success.EncryptedIdentityKey, loginKey)
	if err != nil {
		return nil, fmt.Errorf("unwrap identity key: %w", err)
	}

	return &LoginResult{
		SessionID:          success.SessionID,
		MasterKey:          masterKey,
		IdentityPrivateKey: identityPrivateKeyBytes,
		IdentityPublicKey:  success.IdentityPublicKey,
		FName:              success.FName,
		SName:              success.SName,
	}, nil
}

// ClaimAccount активирует аккаунт, созданный лаборантом (login + claimCode),
// и в том же запросе задаёт постоянный пароль ученика вместе с криптографическими
// ключами. При успехе сразу возвращает LoginResult — дополнительный Login не нужен.
func (n *Node) ClaimAccount(
	ctx context.Context,
	serverAddr string,
	login, claimCode, newPassword string,
) (*LoginResult, error) {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return nil, err
	}

	stream, err := n.host.NewStream(
		ctx,
		serverID,
		protocol.AuthStreamProtocol,
	)
	if err != nil {
		return nil, fmt.Errorf("open auth stream: %w", err)
	}
	defer stream.Close()

	passwordSalt, err := crypto.GenerateSalt()
	if err != nil {
		return nil, fmt.Errorf("generate password salt: %w", err)
	}

	loginKeySalt, err := crypto.GenerateSalt()
	if err != nil {
		return nil, fmt.Errorf("generate login key salt: %w", err)
	}

	passwordHash := crypto.DerivePasswordHash(newPassword, passwordSalt)
	loginKey := crypto.DeriveLoginKey(newPassword, loginKeySalt)

	masterKey := make([]byte, crypto.SharedKeySize)
	if _, err := rand.Read(masterKey); err != nil {
		return nil, fmt.Errorf("generate master key: %w", err)
	}
	identityKey, err := crypto.GenerateIdentityKeyPair()
	if err != nil {
		return nil, fmt.Errorf("generate identity key pair: %w", err)
	}

	identityPublicKey := identityKey.PublicKey().Bytes()
	identityPrivateKeyBytes := identityKey.Bytes()
	encryptedIdentityKey, err := crypto.WrapKey(identityPrivateKeyBytes, loginKey)
	if err != nil {
		return nil, fmt.Errorf("wrap identity key: %w", err)
	}
	encryptedMasterKey, err := crypto.WrapKey(masterKey, loginKey)
	if err != nil {
		return nil, fmt.Errorf("wrap master key: %w", err)
	}

	request := protocol.ClaimRequest{
		Type:                 protocol.AuthTypeClaimRequest,
		Login:                login,
		ClaimCode:            claimCode,
		PasswordHash:         passwordHash,
		PasswordSalt:         passwordSalt,
		LoginKeySalt:         loginKeySalt,
		EncryptedMasterKey:   encryptedMasterKey,
		IdentityPublicKey:    identityPublicKey,
		EncryptedIdentityKey: encryptedIdentityKey,
	}

	data, err := protocol.MarshalJSON(request)
	if err != nil {
		return nil, fmt.Errorf("marshal claim request: %w", err)
	}

	if err := protocol.WriteFramedMessage(stream, data); err != nil {
		return nil, fmt.Errorf("send claim request: %w", err)
	}

	responseData, err := protocol.ReadFramedMessage(stream)
	if err != nil {
		return nil, fmt.Errorf("read claim response: %w", err)
	}

	responseType, err := protocol.PeekType(responseData)
	if err != nil {
		return nil, fmt.Errorf("read claim response type: %w", err)
	}

	switch responseType {
	case protocol.AuthTypeClaimSuccess:
		success, err := protocol.UnmarshalJSON[protocol.ClaimSuccess](responseData)
		if err != nil {
			return nil, fmt.Errorf("parse claim success: %w", err)
		}

		return &LoginResult{
			SessionID:          success.SessionID,
			MasterKey:          masterKey,
			IdentityPrivateKey: identityPrivateKeyBytes,
			IdentityPublicKey:  identityPublicKey,
			FName:              success.FName,
			SName:              success.SName,
		}, nil

	case protocol.AuthTypeClaimFailure:
		failure, err := protocol.UnmarshalJSON[protocol.ClaimFailure](responseData)
		if err != nil {
			return nil, fmt.Errorf("parse claim failure: %w", err)
		}

		return nil, fmt.Errorf("claim failed: %s", failure.Reason)

	default:
		return nil, fmt.Errorf(
			"unexpected claim response type: %s",
			responseType,
		)
	}
}
