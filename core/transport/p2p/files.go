package p2p

import (
	"context"
	"fmt"
	"io"
	"time"

	protocol "github.com/Ryo-del/Syne-protocol"
	"github.com/libp2p/go-libp2p/core/network"
)

// FilesError — ответ сервера с ok=false: код протокола и текст для пользователя.
type FilesError struct{ Code, Message string }

func (e *FilesError) Error() string { return e.Message }

func filesErr(resp protocol.FilesResponse) error {
	if resp.OK {
		return nil
	}
	msg := resp.Error
	if msg == "" {
		msg = resp.Code
	}
	return &FilesError{Code: resp.Code, Message: msg}
}

// ProgressFunc сообщает, сколько байт передано (total = 0 — размер неизвестен).
type ProgressFunc func(done, total int64)

type meter struct {
	done, total int64
	fn          ProgressFunc
	last        time.Time
}

func (m *meter) add(n int) {
	m.done += int64(n)
	if m.fn == nil {
		return
	}
	if now := time.Now(); now.Sub(m.last) >= 200*time.Millisecond || (m.total > 0 && m.done >= m.total) {
		m.last = now
		m.fn(m.done, m.total)
	}
}

type meteredWriter struct {
	w io.Writer
	m *meter
}

func (mw meteredWriter) Write(b []byte) (int, error) {
	n, err := mw.w.Write(b)
	mw.m.add(n)
	return n, err
}

type meteredReader struct {
	r io.Reader
	m *meter
}

func (mr meteredReader) Read(b []byte) (int, error) {
	n, err := mr.r.Read(b)
	mr.m.add(n)
	return n, err
}

// openFilesStream открывает stream к серверу. Отмена ctx сбрасывает stream,
// поэтому долгие передачи прерываются сразу. Вторым значением возвращается
// функция закрытия.
func (n *Node) openFilesStream(ctx context.Context, serverAddr string) (network.Stream, func(), error) {
	serverID, err := n.dialServer(ctx, serverAddr)
	if err != nil {
		return nil, nil, err
	}
	stream, err := n.host.NewStream(ctx, serverID, protocol.FilesStreamProtocol)
	if err != nil {
		return nil, nil, fmt.Errorf("open files stream: %w", err)
	}
	finished := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = stream.Reset()
		case <-finished:
		}
	}()
	return stream, func() {
		close(finished)
		_ = stream.Close()
	}, nil
}

func writeFilesRequest(stream network.Stream, req protocol.FilesRequest) error {
	data, err := protocol.MarshalJSON(req)
	if err != nil {
		return err
	}
	if err := protocol.WriteFramedMessage(stream, data); err != nil {
		return fmt.Errorf("send files request: %w", err)
	}
	return nil
}

func readFilesResponse(stream network.Stream) (protocol.FilesResponse, error) {
	data, err := protocol.ReadFramedMessageMax(stream, protocol.FilesMaxFrame)
	if err != nil {
		return protocol.FilesResponse{}, fmt.Errorf("read files response: %w", err)
	}
	resp, err := protocol.UnmarshalJSON[protocol.FilesResponse](data)
	if err != nil {
		return protocol.FilesResponse{}, fmt.Errorf("parse files response: %w", err)
	}
	return resp, nil
}

// FilesCall — обычный запрос-ответ. Если сервер ответил ошибкой, возвращается
// *FilesError (ответ при этом тоже возвращается).
func (n *Node) FilesCall(ctx context.Context, serverAddr string, req protocol.FilesRequest) (protocol.FilesResponse, error) {
	stream, closeStream, err := n.openFilesStream(ctx, serverAddr)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	defer closeStream()

	if err := writeFilesRequest(stream, req); err != nil {
		return protocol.FilesResponse{}, err
	}
	resp, err := readFilesResponse(stream)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	return resp, filesErr(resp)
}

// FilesDownload — read, download и download_dir. После ответа сервера (с
// описанием файла) вызывается open: он возвращает, куда писать байты. Для
// файлов читается ровно entry.Size байт, для архива папки — до конца потока;
// обрыв передачи возвращается ошибкой, а не «коротким» успехом.
func (n *Node) FilesDownload(ctx context.Context, serverAddr string, req protocol.FilesRequest,
	open func(entry protocol.FileEntry) (io.Writer, error), onProgress ProgressFunc) (protocol.FilesResponse, error) {

	stream, closeStream, err := n.openFilesStream(ctx, serverAddr)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	defer closeStream()

	if err := writeFilesRequest(stream, req); err != nil {
		return protocol.FilesResponse{}, err
	}
	resp, err := readFilesResponse(stream)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	if err := filesErr(resp); err != nil {
		return resp, err
	}
	if resp.Entry == nil {
		return resp, fmt.Errorf("files: server sent no file description")
	}

	dst, err := open(*resp.Entry)
	if err != nil {
		return resp, err
	}
	m := &meter{fn: onProgress}
	w := meteredWriter{w: dst, m: m}
	if req.Op == protocol.FilesOpDownloadDir {
		_, err = io.Copy(w, stream)
	} else {
		m.total = resp.Entry.Size
		_, err = io.CopyN(w, stream, resp.Entry.Size)
	}
	if err != nil {
		return resp, fmt.Errorf("download interrupted: %w", err)
	}
	if onProgress != nil {
		onProgress(m.done, m.total)
	}
	return resp, nil
}

// FilesUpload — upload и write. req.Size должен совпадать с числом байт в src.
// Сервер сначала проверяет права, имя и квоту; если он ответил ошибкой или
// политикой skip (Skipped > 0), байты не отправляются.
func (n *Node) FilesUpload(ctx context.Context, serverAddr string, req protocol.FilesRequest,
	src io.Reader, onProgress ProgressFunc) (protocol.FilesResponse, error) {

	stream, closeStream, err := n.openFilesStream(ctx, serverAddr)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	defer closeStream()

	if err := writeFilesRequest(stream, req); err != nil {
		return protocol.FilesResponse{}, err
	}
	resp, err := readFilesResponse(stream)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	if err := filesErr(resp); err != nil {
		return resp, err
	}
	if !resp.Ready {
		return resp, nil // политика skip: принимать нечего
	}

	m := &meter{total: req.Size, fn: onProgress}
	if _, err := io.CopyN(stream, meteredReader{r: src, m: m}, req.Size); err != nil {
		return protocol.FilesResponse{}, fmt.Errorf("upload interrupted: %w", err)
	}
	final, err := readFilesResponse(stream)
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	return final, filesErr(final)
}
