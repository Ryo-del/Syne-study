package app

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (s *Service) ReportError(message string) error {
	sess, err := s.currentSession()
	if err != nil {
		return err
	}
	message = strings.TrimSpace(message)
	if message == "" || len(message) > 10000 {
		return fmt.Errorf("error report must contain 1 to 10000 characters")
	}
	addr := strings.TrimSpace(s.cfg.ServerAddr)
	if addr == "" {
		return fmt.Errorf("study server is not connected")
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	return s.node.ErrorReport(ctx, addr, sess.SessionID, message)
}
