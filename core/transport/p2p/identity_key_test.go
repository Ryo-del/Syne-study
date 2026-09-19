package p2p

import (
	"context"
	"testing"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peer"
)

type testIdentityKeyProvider struct {
	publicKey []byte
	ok        bool
}

func (p testIdentityKeyProvider) CurrentIdentityPublicKey() ([]byte, bool) {
	return p.publicKey, p.ok
}

func (p testIdentityKeyProvider) CurrentUserInfo() (string, string, string, bool) {
	return "", "", "", false
}

func newIdentityTestNode(t *testing.T) *Node {
	t.Helper()

	host, err := libp2p.New()
	if err != nil {
		t.Fatalf("create libp2p host: %v", err)
	}

	t.Cleanup(func() {
		_ = host.Close()
	})

	return &Node{
		host: host,
	}
}

func connectIdentityTestNodes(t *testing.T, client, server *Node) {
	t.Helper()

	err := client.host.Connect(context.Background(), peer.AddrInfo{
		ID:    server.host.ID(),
		Addrs: server.host.Addrs(),
	})
	if err != nil {
		t.Fatalf("connect nodes: %v", err)
	}
}

func TestNode_GetIdentityKey(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		server := newIdentityTestNode(t)
		client := newIdentityTestNode(t)

		expectedKey := []byte("test-identity-public-key")

		server.SetIdentityKeyHandler(testIdentityKeyProvider{
			publicKey: expectedKey,
			ok:        true,
		})

		connectIdentityTestNodes(t, client, server)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		got, err := client.GetIdentityKey(
			ctx,
			server.host.ID().String(),
		)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got == nil {
			t.Fatal("response is nil")
		}

		if got.Type != protocol.IdentityKeyTypeResponse {
			t.Fatalf(
				"got type %q, want %q",
				got.Type,
				protocol.IdentityKeyTypeResponse,
			)
		}

		if string(got.IdentityPublicKey) != string(expectedKey) {
			t.Fatalf(
				"got public key %q, want %q",
				got.IdentityPublicKey,
				expectedKey,
			)
		}
	})

	t.Run("invalid target peer id", func(t *testing.T) {
		node := newIdentityTestNode(t)

		_, err := node.GetIdentityKey(
			context.Background(),
			"invalid-peer-id",
		)
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		const prefix = "parse target peer id"

		if len(err.Error()) < len(prefix) ||
			err.Error()[:len(prefix)] != prefix {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("open stream error", func(t *testing.T) {
		client := newIdentityTestNode(t)
		target := newIdentityTestNode(t)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		_, err := client.GetIdentityKey(
			ctx,
			target.host.ID().String(),
		)
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		const prefix = "open identity key stream"

		if len(err.Error()) < len(prefix) ||
			err.Error()[:len(prefix)] != prefix {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("provider has no identity key", func(t *testing.T) {
		server := newIdentityTestNode(t)
		client := newIdentityTestNode(t)

		server.SetIdentityKeyHandler(testIdentityKeyProvider{
			publicKey: nil,
			ok:        false,
		})

		connectIdentityTestNodes(t, client, server)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		_, err := client.GetIdentityKey(
			ctx,
			server.host.ID().String(),
		)
		if err == nil {
			t.Fatal("expected error because server sends no response")
		}
	})
}

func TestNode_SetIdentityKeyHandler(t *testing.T) {
	t.Run("returns current identity public key", func(t *testing.T) {
		server := newIdentityTestNode(t)
		client := newIdentityTestNode(t)

		expectedKey := []byte{
			0x01, 0x02, 0x03, 0x04,
			0x05, 0x06, 0x07, 0x08,
		}

		server.SetIdentityKeyHandler(testIdentityKeyProvider{
			publicKey: expectedKey,
			ok:        true,
		})

		connectIdentityTestNodes(t, client, server)

		got, err := client.GetIdentityKey(
			context.Background(),
			server.host.ID().String(),
		)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got == nil {
			t.Fatal("response is nil")
		}

		if got.Type != protocol.IdentityKeyTypeResponse {
			t.Fatalf(
				"got type %q, want %q",
				got.Type,
				protocol.IdentityKeyTypeResponse,
			)
		}

		if string(got.IdentityPublicKey) != string(expectedKey) {
			t.Fatalf(
				"got public key %v, want %v",
				got.IdentityPublicKey,
				expectedKey,
			)
		}
	})
}
