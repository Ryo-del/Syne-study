package p2p

import (
	"Syne/core/crypto"
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWelcomefromPeer(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	node, addr := startTestServerAndPeer(t, ctx)

	w, err := node.ConnectToServer(ctx, addr)
	if err != nil {
		t.Fatalf("failed to connect to server: %v", err)
	}

	if w.ServerID == "" || w.ServerVersion == "" {
		t.Fatalf("invalid welcome message: %+v", w)
	}
}
func TestRegisterAndLogin(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	node, addr := startTestServerAndPeer(t, ctx)

	masterKey, err := node.Register(
		ctx,
		addr,
		"28gf34",
		"Иван",
		"Иванов",
		"correct horse battery staple",
	)
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	if len(masterKey) == 0 {
		t.Fatal("expected non-empty master key")
	}

	result, err := node.Login(
		ctx,
		addr,
		"28gf34",
		"correct horse battery staple",
	)
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}

	if result.FName != "Иван" || result.SName != "Иванов" {
		t.Fatalf("unexpected name: %+v", result)
	}

	if result.SessionID == "" {
		t.Fatal("expected non-empty session ID")
	}

	if !bytes.Equal(result.MasterKey, masterKey) {
		t.Fatal("master key from login does not match master key from registration")
	}
}
func startTestServerAndPeer(t *testing.T, ctx context.Context) (*Node, string) {
	t.Helper()

	serverRepo := os.Getenv("SYNE_SERVER_REPO")
	if serverRepo == "" {
		serverRepo = "../../../../Syne server"
	}

	serverWorkDir := t.TempDir()
	peerWorkDir := t.TempDir()
	serverBinary := filepath.Join(t.TempDir(), "syne-server")

	build := exec.Command("go", "build", "-o", serverBinary, "./cmd/syne-server")
	build.Dir = serverRepo

	output, err := build.CombinedOutput()
	if err != nil {
		t.Fatalf("failed to build server: %v\n%s", err, output)
	}

	cmd := exec.Command(serverBinary)
	cmd.Dir = serverWorkDir

	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.Fatalf("failed to get stderr pipe: %v", err)
	}

	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start server: %v", err)
	}

	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	addrCh := make(chan string, 1)
	errCh := make(chan error, 1)

	go func() {
		scanner := bufio.NewScanner(stderr)

		for scanner.Scan() {
			line := scanner.Text()
			t.Logf("server output: %s", line)

			if strings.Contains(line, "listening addr=") {
				idx := strings.Index(line, "addr=")
				addrCh <- line[idx+len("addr="):]
				return
			}
		}

		if err := scanner.Err(); err != nil {
			errCh <- fmt.Errorf("reading server stderr: %w", err)
			return
		}

		errCh <- fmt.Errorf("server output ended without listening address")
	}()

	var addr string

	select {
	case addr = <-addrCh:
		t.Logf("server address: %s", addr)

	case err := <-errCh:
		t.Fatalf("reading server output: %v", err)

	case <-ctx.Done():
		t.Fatal("timed out waiting for server to start listening")
	}

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get cwd: %v", err)
	}

	if err := os.Chdir(peerWorkDir); err != nil {
		t.Fatalf("failed to chdir: %v", err)
	}

	t.Cleanup(func() {
		_ = os.Chdir(origDir)
	})

	identity, err := crypto.LoadOrCreateIdentity()
	if err != nil {
		t.Fatalf("failed to load or create identity: %v", err)
	}

	node, err := NewNode(ctx, identity, nil, nil)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	return node, addr
}
