package app

import (
	"context"
	"fmt"
	"strings"

	p2ptransport "Syne/core/transport/p2p"
)

func (s *Service) SearchDirectory(ctx context.Context, query string) ([]p2ptransport.DirectoryUser, error) {
	sess, err := s.currentSession()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(s.cfg.ServerAddr) == "" {
		return nil, fmt.Errorf("study server is not connected")
	}
	limit := 10
	if strings.TrimSpace(query) != "" {
		limit = 30
	}
	users, err := s.node.Directory(ctx, s.cfg.ServerAddr, sess.SessionID, query, limit)
	if err != nil {
		return nil, err
	}

	// «В сети» и peer_id берём из живого presence, а не с сервера.
	s.stateMu.RLock()
	for i := range users {
		if online, ok := s.onlineUsers[users[i].Login]; ok {
			users[i].PeerID = online.PeerID
			users[i].Online = true
		}
	}
	s.stateMu.RUnlock()
	return users, nil
}
