package main

import (
	"Syne/core/app"
	p2ptransport "Syne/core/transport/p2p"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	protocol "github.com/Ryo-del/Syne-protocol"
)

func (s *server) registerFilesRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/files/call", s.handleFilesCall)
	mux.HandleFunc("/api/files/read-text", s.handleFilesReadText)
	mux.HandleFunc("/api/files/write-text", s.handleFilesWriteText)
	mux.HandleFunc("/api/files/download", s.handleFilesDownload)
	mux.HandleFunc("/api/files/upload", s.handleFilesUpload)
	mux.HandleFunc("/api/files/cancel", s.handleFilesCancel)
	mux.HandleFunc("/api/files/blob", s.handleFilesBlob)
}

func filesStatus(code string) int {
	switch code {
	case protocol.FilesErrUnauthorized:
		return http.StatusUnauthorized
	case protocol.FilesErrForbidden:
		return http.StatusForbidden
	case protocol.FilesErrNotFound:
		return http.StatusNotFound
	case protocol.FilesErrExists, protocol.FilesErrConflict:
		return http.StatusConflict
	case protocol.FilesErrQuota:
		return http.StatusRequestEntityTooLarge
	case protocol.FilesErrInvalidPath, protocol.FilesErrInvalidRequest, "invalid_encoding":
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

// writeFilesError: ответ сервера (с кодом) или сетевая ошибка.
func writeFilesError(w http.ResponseWriter, err error) {
	var fe *p2ptransport.FilesError
	if errors.As(err, &fe) {
		writeJSON(w, filesStatus(fe.Code), map[string]string{"error": fe.Message, "code": fe.Code})
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

func decodeLimited(w http.ResponseWriter, r *http.Request, dst any, max int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	return decodeJSON(r, dst)
}

func requirePost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return false
	}
	return true
}

func (s *server) handleFilesCall(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req protocol.FilesRequest
	if err := decodeLimited(w, r, &req, 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	resp, err := s.service.FilesCall(r.Context(), req)
	if err != nil {
		writeFilesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// maxBlobBytes — потолок размера файла для предпросмотра в чате.
const maxBlobBytes = int64(64) << 20

func blobContentType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	}
	return "application/octet-stream"
}

// handleFilesBlob отдаёт байты файла (для фото в чате). Права проверяет сервер:
// нужно право «скачивание», как при обычной загрузке на диск.
func (s *server) handleFilesBlob(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		Owner string `json:"owner"`
		Path  string `json:"path"`
	}
	if err := decodeLimited(w, r, &req, 1<<16); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	started := false
	err := s.service.FilesStream(r.Context(), req.Owner, req.Path, func(e protocol.FileEntry) (io.Writer, error) {
		if e.IsDir {
			return nil, &p2ptransport.FilesError{Code: protocol.FilesErrInvalidRequest, Message: "not a file"}
		}
		if e.Size > maxBlobBytes {
			return nil, &p2ptransport.FilesError{Code: protocol.FilesErrInvalidRequest, Message: "file is too large to preview"}
		}
		h := w.Header()
		h.Set("Content-Type", blobContentType(e.Name))
		h.Set("Content-Length", strconv.FormatInt(e.Size, 10))
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		started = true
		return w, nil
	})
	if err != nil {
		if !started {
			writeFilesError(w, err)
			return
		}
		// Обрыв посреди потока: сбрасываем соединение, чтобы клиент не принял неполный файл за целый.
		panic(http.ErrAbortHandler)
	}
}
func (s *server) handleFilesReadText(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		Owner string `json:"owner"`
		Path  string `json:"path"`
	}
	if err := decodeLimited(w, r, &req, 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ft, err := s.service.FilesReadText(r.Context(), req.Owner, req.Path)
	if err != nil {
		writeFilesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ft)
}

func (s *server) handleFilesWriteText(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		Owner       string `json:"owner"`
		Path        string `json:"path"`
		Text        string `json:"text"`
		BaseModTime int64  `json:"base_mod_time"`
	}
	if err := decodeLimited(w, r, &req, 16<<20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entry, err := s.service.FilesWriteText(r.Context(), req.Owner, req.Path, req.Text, req.BaseModTime)
	if err != nil {
		writeFilesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": entry})
}

func (s *server) handleFilesDownload(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req app.DownloadRequest
	if err := decodeLimited(w, r, &req, 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := s.service.FilesDownloadToDisk(r.Context(), req)
	if err != nil {
		writeFilesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *server) handleFilesUpload(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req app.UploadRequest
	if err := decodeLimited(w, r, &req, 4<<20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := s.service.FilesUploadFromDisk(r.Context(), req)
	if err != nil {
		writeFilesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *server) handleFilesCancel(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		TransferID string `json:"transfer_id"`
	}
	if err := decodeLimited(w, r, &req, 1<<16); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": s.service.CancelTransfer(req.TransferID)})
}
