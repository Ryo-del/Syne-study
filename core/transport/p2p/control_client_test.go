package p2p

import (
	"Syne/core/crypto"
	"bufio"
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
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*20)
	defer cancel()

	serverRepo := os.Getenv("SYNE_SERVER_REPO")
	if serverRepo == "" {
		serverRepo = "../../../../Syne server"
	}

	// Две РАЗНЫЕ временные папки — каждая своя для сервера и для Peer,
	// чтобы у них не совпал .identity файл и, как следствие, PeerID.
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
	cmd.Dir = serverWorkDir // <-- было "cmd = serverWorkDir" — это вообще другой тип, не компилировалось бы

	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.Fatalf("failed to get stderr pipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start server: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
	}()

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

	// Peer получает СВОЮ identity, отдельную от серверной,
	// именно за счёт смены рабочей директории на peerWorkDir прямо перед вызовом.
	origDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get cwd: %v", err)
	}
	if err := os.Chdir(peerWorkDir); err != nil {
		t.Fatalf("failed to chdir: %v", err)
	}
	defer func() {
		_ = os.Chdir(origDir)
	}()

	identity, err := crypto.LoadOrCreateIdentity()
	if err != nil {
		t.Fatalf("failed to load or create identity: %v", err)
	}
	node, err := NewNode(ctx, identity, nil, nil)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}
	w, err := node.ConnectToServer(ctx, addr)
	if err != nil {
		t.Fatalf("failed to connect to server: %v", err)
	}
	if w.ServerID == "" || w.ServerVersion == "" {
		t.Fatalf("invalid welcome message: %+v", w)
	}
}
