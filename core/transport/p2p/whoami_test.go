package p2p

import (
	"context"
	"testing"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peer"
)

type testSessionProvider struct {
	userID string
	fname  string
	sname  string
	ok     bool
}

func (p testSessionProvider) CurrentUserInfo() (string, string, string, bool) {
	return p.userID, p.fname, p.sname, p.ok
}

func newTestNode(t *testing.T) *Node {
	t.Helper()

	h, err := libp2p.New()
	if err != nil {
		t.Fatalf("create libp2p host: %v", err)
	}

	t.Cleanup(func() {
		_ = h.Close()
	})

	return &Node{
		host: h,
	}
}

func connectTestNodes(t *testing.T, a, b *Node) {
	t.Helper()

	err := a.host.Connect(context.Background(), peer.AddrInfo{
		ID:    b.host.ID(),
		Addrs: b.host.Addrs(),
	})
	if err != nil {
		t.Fatalf("connect nodes: %v", err)
	}
}

func TestPeerIDFromString(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		node := newTestNode(t)
		id := node.host.ID()

		got, err := peerIDFromString(id.String())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got != id {
			t.Fatalf("got peer ID %q, want %q", got, id)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		_, err := peerIDFromString("invalid-peer-id")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestNode_WhoAmI(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		server := newTestNode(t)
		client := newTestNode(t)

		server.SetWhoAmIHandler(testSessionProvider{
			userID: "student-123",
			fname:  "Artem",
			sname:  "Ivanov",
			ok:     true,
		})

		connectTestNodes(t, client, server)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		got, err := client.WhoAmI(ctx, server.host.ID().String())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got == nil {
			t.Fatal("response is nil")
		}

		if got.Type != protocol.WhoAmITypeResponse {
			t.Fatalf(
				"got type %q, want %q",
				got.Type,
				protocol.WhoAmITypeResponse,
			)
		}

		if got.UserID != "student-123" {
			t.Fatalf("got user ID %q, want %q", got.UserID, "student-123")
		}

		if got.FName != "Artem" {
			t.Fatalf("got first name %q, want %q", got.FName, "Artem")
		}

		if got.SName != "Ivanov" {
			t.Fatalf("got surname %q, want %q", got.SName, "Ivanov")
		}
	})

	t.Run("invalid target peer id", func(t *testing.T) {
		node := newTestNode(t)

		_, err := node.WhoAmI(context.Background(), "invalid-peer-id")
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		if got := err.Error(); got[:len("parse target peer id")] != "parse target peer id" {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("open stream error", func(t *testing.T) {
		client := newTestNode(t)
		target := newTestNode(t)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		_, err := client.WhoAmI(ctx, target.host.ID().String())
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		if got := err.Error(); got[:len("open whoami stream")] != "open whoami stream" {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("provider is not logged in", func(t *testing.T) {
		server := newTestNode(t)
		client := newTestNode(t)

		server.SetWhoAmIHandler(testSessionProvider{
			ok: false,
		})

		connectTestNodes(t, client, server)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		_, err := client.WhoAmI(ctx, server.host.ID().String())
		if err == nil {
			t.Fatal("expected error because server sends no response")
		}
	})
}

func TestNode_SetWhoAmIHandler(t *testing.T) {
	t.Run("returns current user info", func(t *testing.T) {
		server := newTestNode(t)
		client := newTestNode(t)

		server.SetWhoAmIHandler(testSessionProvider{
			userID: "user-42",
			fname:  "John",
			sname:  "Smith",
			ok:     true,
		})

		connectTestNodes(t, client, server)

		got, err := client.WhoAmI(
			context.Background(),
			server.host.ID().String(),
		)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got.UserID != "user-42" {
			t.Fatalf("got user ID %q, want %q", got.UserID, "user-42")
		}

		if got.FName != "John" {
			t.Fatalf("got first name %q, want %q", got.FName, "John")
		}

		if got.SName != "Smith" {
			t.Fatalf("got surname %q, want %q", got.SName, "Smith")
		}
	})
}
