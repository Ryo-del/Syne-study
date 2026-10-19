package main

import (
	"encoding/json"
	"io"
	"net/http"
)

func (s *server) handleUserSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		data, exists, err := s.service.UserSettings()
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		if !exists || len(data) == 0 {
			data = []byte(`{}`)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	case http.MethodPut:
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256*1024))
		if err != nil || !json.Valid(body) {
			writeError(w, http.StatusBadRequest, "invalid settings payload")
			return
		}
		if err := s.service.SaveUserSettings(body); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeLimited(w, r, &req, 16*1024); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.service.ChangePassword(req.CurrentPassword, req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
