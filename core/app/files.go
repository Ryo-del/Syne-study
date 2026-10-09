package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	corechat "Syne/core/chat"
	p2ptransport "Syne/core/transport/p2p"

	protocol "github.com/Ryo-del/Syne-protocol"
)

const (
	maxUploadFileBytes = int64(2) << 30
	filesCallTimeout   = 40 * time.Second
	filesLongTimeout   = 16 * time.Minute
)

// TransferProgress — состояние передачи для интерфейса (событие "file_transfer").
type TransferProgress struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Done  int64  `json:"done"`
	Total int64  `json:"total"` // 0 — размер неизвестен (архив папки)
	State string `json:"state"` // running | done | error
	Error string `json:"error,omitempty"`
}

func (s *Service) transferEmitter(id, name string) func(done, total int64, state, errText string) {
	if id == "" {
		return func(int64, int64, string, string) {}
	}
	return func(done, total int64, state, errText string) {
		s.emit(Event{
			Type:      "file_transfer",
			Timestamp: time.Now().UnixMilli(),
			Transfer:  &TransferProgress{ID: id, Name: name, Done: done, Total: total, State: state, Error: errText},
		})
	}
}

var transfers sync.Map // id передачи -> context.CancelFunc

func (s *Service) beginTransfer(parent context.Context, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	if id != "" {
		transfers.Store(id, cancel)
	}
	return ctx, func() {
		cancel()
		if id != "" {
			transfers.Delete(id)
		}
	}
}

// CancelTransfer прерывает передачу по её id.
func (s *Service) CancelTransfer(id string) bool {
	v, ok := transfers.LoadAndDelete(id)
	if !ok {
		return false
	}
	v.(context.CancelFunc)()
	return true
}

func (s *Service) filesSession() (*UserSession, string, error) {
	sess, err := s.currentSession()
	if err != nil {
		return nil, "", err
	}
	addr := strings.TrimSpace(s.cfg.ServerAddr)
	if addr == "" {
		return nil, "", errors.New("study server is not connected")
	}
	return sess, addr, nil
}

// ---------- обычные запросы ----------

// plainFilesOps — операции, которые интерфейс может выполнять напрямую.
// Потоковые (чтение, загрузка, скачивание) и служебные (contacts_put,
// blocked_put) идут своими путями.
var plainFilesOps = map[string]bool{
	protocol.FilesOpListOwners: true, protocol.FilesOpList: true, protocol.FilesOpStat: true,
	protocol.FilesOpMkdir: true, protocol.FilesOpCreate: true, protocol.FilesOpRename: true,
	protocol.FilesOpDelete: true, protocol.FilesOpPaste: true, protocol.FilesOpDuplicate: true,
	protocol.FilesOpRulesGet: true, protocol.FilesOpRuleSet: true, protocol.FilesOpRuleClear: true,
	protocol.FilesOpQuota: true, protocol.FilesOpFavAdd: true, protocol.FilesOpFavRemove: true,
	protocol.FilesOpFavList: true, protocol.FilesOpUIGet: true, protocol.FilesOpUIPut: true,
	protocol.FilesOpSearch: true, protocol.FilesOpSend: true,
}

func filesOpTimeout(op string) time.Duration {
	switch op {
	case protocol.FilesOpPaste, protocol.FilesOpDuplicate, protocol.FilesOpDelete, protocol.FilesOpSend:
		return filesLongTimeout
	case protocol.FilesOpSearch:
		return 30 * time.Second
	}
	return filesCallTimeout
}

func (s *Service) callTimeout(ctx context.Context, addr string, req protocol.FilesRequest, d time.Duration) (protocol.FilesResponse, error) {
	cctx, cancel := context.WithTimeout(ctx, d)
	defer cancel()
	return s.node.FilesCall(cctx, addr, req)
}

// FilesCall передаёт серверу запрос интерфейса (session_id подставляется здесь).
func (s *Service) FilesCall(ctx context.Context, req protocol.FilesRequest) (protocol.FilesResponse, error) {
	if !plainFilesOps[req.Op] {
		return protocol.FilesResponse{}, fmt.Errorf("unsupported operation: %q", req.Op)
	}
	sess, addr, err := s.filesSession()
	if err != nil {
		return protocol.FilesResponse{}, err
	}
	req.SessionID = sess.SessionID
	return s.callTimeout(ctx, addr, req, filesOpTimeout(req.Op))
}

// ---------- текстовые файлы (редактор) ----------

// FileText — содержимое .txt для редактора.
type FileText struct {
	Entry protocol.FileEntry `json:"entry"`
	Text  string             `json:"text"`
}

func (s *Service) FilesReadText(ctx context.Context, owner, path string) (FileText, error) {
	sess, addr, err := s.filesSession()
	if err != nil {
		return FileText{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	var buf bytes.Buffer
	req := protocol.FilesRequest{Op: protocol.FilesOpRead, SessionID: sess.SessionID, Owner: owner, Path: path}
	resp, err := s.node.FilesDownload(ctx, addr, req,
		func(protocol.FileEntry) (io.Writer, error) { return &buf, nil }, nil)
	if err != nil {
		return FileText{}, err
	}
	if !utf8.Valid(buf.Bytes()) {
		return FileText{}, &p2ptransport.FilesError{Code: "invalid_encoding", Message: "the file is not valid UTF-8"}
	}
	return FileText{Entry: *resp.Entry, Text: buf.String()}, nil
}

// FilesWriteText сохраняет .txt. baseModTime — entry.mod_time версии, с
// которой начали правку: если файл изменился, сервер вернёт код conflict.
// Возвращаемая запись может быть nil (файл сохранён, но описание получить
// не удалось): интерфейс тогда перечитывает файл сам.
func (s *Service) FilesWriteText(ctx context.Context, owner, path, text string, baseModTime int64) (*protocol.FileEntry, error) {
	sess, addr, err := s.filesSession()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	data := []byte(text)
	req := protocol.FilesRequest{
		Op: protocol.FilesOpWrite, SessionID: sess.SessionID, Owner: owner, Path: path,
		Size: int64(len(data)), BaseModTime: baseModTime,
	}
	resp, err := s.node.FilesUpload(ctx, addr, req, bytes.NewReader(data), nil)
	if err != nil {
		return nil, err
	}
	return resp.Entry, nil
}

// ---------- скачивание на диск ----------

type DownloadRequest struct {
	Owner      string `json:"owner"`
	Path       string `json:"path"`
	Dir        bool   `json:"dir"`         // папку скачать архивом .zip
	DestDir    string `json:"dest_dir"`    // каталог: имя выбирается само («имя (1).txt» при совпадении)
	DestPath   string `json:"dest_path"`   // полный путь из диалога «Скачать как» (заменяет существующий)
	TransferID string `json:"transfer_id"` // для прогресса и отмены
}

type DownloadResult struct {
	Path    string `json:"path"`
	Bytes   int64  `json:"bytes"`
	Skipped int    `json:"skipped,omitempty"` // элементов папки не вошло в архив из-за прав
}

func (s *Service) FilesDownloadToDisk(ctx context.Context, d DownloadRequest) (DownloadResult, error) {
	sess, addr, err := s.filesSession()
	if err != nil {
		return DownloadResult{}, err
	}
	if (d.DestDir == "") == (d.DestPath == "") {
		return DownloadResult{}, errors.New("exactly one of dest_dir and dest_path is required")
	}
	dir := d.DestDir
	if d.DestPath != "" {
		if !filepath.IsAbs(d.DestPath) {
			return DownloadResult{}, errors.New("dest_path must be absolute")
		}
		dir = filepath.Dir(d.DestPath)
	}
	if !filepath.IsAbs(dir) {
		return DownloadResult{}, errors.New("destination must be an absolute path")
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return DownloadResult{}, errors.New("destination folder does not exist")
	}

	op := protocol.FilesOpDownload
	if d.Dir {
		op = protocol.FilesOpDownloadDir
	}
	ctx, finish := s.beginTransfer(ctx, d.TransferID)
	defer finish()
	emit := s.transferEmitter(d.TransferID, filepath.Base(d.Path))
	emit(0, 0, "running", "")

	var (
		tmp       *os.File
		entryName string
	)
	open := func(e protocol.FileEntry) (io.Writer, error) {
		entryName = e.Name
		f, err := os.CreateTemp(dir, ".syne-part-*")
		if err != nil {
			return nil, err
		}
		tmp = f
		return f, nil
	}
	req := protocol.FilesRequest{Op: op, SessionID: sess.SessionID, Owner: d.Owner, Path: d.Path}
	resp, err := s.node.FilesDownload(ctx, addr, req, open,
		func(done, total int64) { emit(done, total, "running", "") })
	if tmp != nil {
		if cerr := tmp.Close(); err == nil {
			err = cerr
		}
	}
	if err != nil {
		if tmp != nil {
			_ = os.Remove(tmp.Name())
		}
		emit(0, 0, "error", err.Error())
		return DownloadResult{}, err
	}

	final, err := placeDownloaded(tmp.Name(), dir, d.DestPath, entryName)
	if err != nil {
		_ = os.Remove(tmp.Name())
		emit(0, 0, "error", err.Error())
		return DownloadResult{}, err
	}
	res := DownloadResult{Path: final, Skipped: resp.Skipped}
	if st, err := os.Stat(final); err == nil {
		res.Bytes = st.Size()
	}
	emit(res.Bytes, res.Bytes, "done", "")
	return res, nil
}

// placeDownloaded ставит скачанный временный файл на место.
func placeDownloaded(tmp, dir, destPath, name string) (string, error) {
	if destPath != "" {
		if err := os.Rename(tmp, destPath); err != nil {
			return "", err
		}
		return destPath, nil
	}
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		name = "download"
	}
	for i := 0; i < 1000; i++ {
		cand := localCandidate(dir, name, i)
		if _, err := os.Lstat(cand); errors.Is(err, os.ErrNotExist) {
			if err := os.Rename(tmp, cand); err != nil {
				return "", err
			}
			return cand, nil
		}
	}
	return "", errors.New("cannot choose a file name")
}

func localCandidate(dir, name string, i int) string {
	if i == 0 {
		return filepath.Join(dir, name)
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if stem == "" {
		stem, ext = name, ""
	}
	return filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
}

// ---------- загрузка с диска (перетаскивание) ----------

type UploadRequest struct {
	Owner      string   `json:"owner"`
	Path       string   `json:"path"`        // папка назначения на сервере
	LocalPaths []string `json:"local_paths"` // файлы и папки с ПК (абсолютные пути)
	OnConflict string   `json:"on_conflict"` // "" — спросить, rename | replace | skip
	TransferID string   `json:"transfer_id"`
	FilesOnly  bool     `json:"files_only"`
}

type UploadFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type UploadResult struct {
	Uploaded  int                  `json:"uploaded"`
	Skipped   int                  `json:"skipped"`
	Failed    []UploadFailure      `json:"failed,omitempty"`
	Conflicts []string             `json:"conflicts,omitempty"` // имена, которые уже есть; загрузка не начата, ждём выбор
	Items     []protocol.FileEntry `json:"items,omitempty"`     // загруженные файлы верхнего уровня (с итоговыми путями)
}

type uploadItem struct {
	local string
	group int    // индекс верхнего элемента, к которому относится
	dir   string // путь внутри верхней папки (для верхнего элемента пуст)
	name  string
	isDir bool
	size  int64
	top   bool
}

type groupState struct {
	name    string // имя на сервере
	skip    bool
	failed  bool
	replace bool
}

func joinRemote(parent, name string) string {
	if name == "" {
		return parent
	}
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

func planUpload(locals []string) ([]uploadItem, int64, error) {
	var items []uploadItem
	var total int64
	for g, lp := range locals {
		if !filepath.IsAbs(lp) {
			return nil, 0, fmt.Errorf("local path must be absolute: %s", lp)
		}
		if isJunkName(filepath.Base(lp)) {
			continue
		}
		info, err := os.Lstat(lp)
		if err != nil {
			return nil, 0, err
		}
		name := filepath.Base(lp)
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			continue
		case info.Mode().IsRegular():
			items = append(items, uploadItem{local: lp, group: g, name: name, size: info.Size(), top: true})
			total += info.Size()
		case info.IsDir():
			items = append(items, uploadItem{local: lp, group: g, name: name, isDir: true, top: true})
			if err := collectDir(lp, g, "", &items, &total); err != nil {
				return nil, 0, err
			}
		}
	}
	return items, total, nil
}

func collectDir(local string, group int, rel string, items *[]uploadItem, total *int64) error {
	des, err := os.ReadDir(local)
	if err != nil {
		return err
	}
	for _, de := range des {
		if isJunkName(de.Name()) {
			continue
		}
		info, err := de.Info()
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		p := filepath.Join(local, de.Name())
		switch {
		case info.Mode().IsRegular():
			*items = append(*items, uploadItem{local: p, group: group, dir: rel, name: de.Name(), size: info.Size()})
			*total += info.Size()
		case info.IsDir():
			*items = append(*items, uploadItem{local: p, group: group, dir: rel, name: de.Name(), isDir: true})
			if err := collectDir(p, group, joinRemote(rel, de.Name()), items, total); err != nil {
				return err
			}
		}
	}
	return nil
}

// nextFreeName — «имя (1).txt»; taken — занятые имена в нижнем регистре.
func nextFreeName(taken map[string]bool, name string, isDir bool) string {
	stem, ext := name, ""
	if !isDir {
		if i := strings.LastIndexByte(name, '.'); i > 0 {
			stem, ext = name[:i], name[i:]
		}
	}
	for i := 1; ; i++ {
		cand := fmt.Sprintf("%s (%d)%s", stem, i, ext)
		if !taken[strings.ToLower(cand)] {
			return cand
		}
	}
}

// FilesStream отдаёт файл потоком. open вызывается, когда сервер уже разрешил
// чтение и прислал описание файла: там можно проверить размер и отправить заголовки.
func (s *Service) FilesStream(ctx context.Context, owner, path string,
	open func(entry protocol.FileEntry) (io.Writer, error)) error {

	sess, addr, err := s.filesSession()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, filesLongTimeout)
	defer cancel()
	req := protocol.FilesRequest{Op: protocol.FilesOpDownload, SessionID: sess.SessionID, Owner: owner, Path: path}
	_, err = s.node.FilesDownload(ctx, addr, req, open, nil)
	return err
}

// FilesUploadFromDisk загружает файлы и папки с ПК. Если какие-то верхние
// имена уже есть на сервере, а политика не выбрана, ничего не загружается:
// возвращаются Conflicts, интерфейс спрашивает пользователя и повторяет
// запрос с выбранной политикой. Ошибки отдельных файлов не останавливают
// остальную загрузку и возвращаются в Failed.
func (s *Service) FilesUploadFromDisk(ctx context.Context, u UploadRequest) (UploadResult, error) {
	sess, addr, err := s.filesSession()
	if err != nil {
		return UploadResult{}, err
	}
	switch u.OnConflict {
	case "", protocol.ConflictRename, protocol.ConflictReplace, protocol.ConflictSkip:
	default:
		return UploadResult{}, errors.New("unknown conflict policy")
	}
	if u.FilesOnly {
		files := make([]string, 0, len(u.LocalPaths))
		for _, p := range u.LocalPaths {
			if fi, err := os.Lstat(p); err == nil && fi.Mode().IsRegular() {
				files = append(files, p)
			}
		}
		u.LocalPaths = files
	}
	items, total, err := planUpload(u.LocalPaths)
	if err != nil {
		return UploadResult{}, err
	}
	if len(items) == 0 {
		return UploadResult{}, errors.New("nothing to upload")
	}

	ctx, finish := s.beginTransfer(ctx, u.TransferID)
	defer finish()

	// Что уже лежит в папке назначения (то, что пользователь не видит, определит сервер).
	taken := map[string]bool{}
	listReq := protocol.FilesRequest{Op: protocol.FilesOpList, SessionID: sess.SessionID, Owner: u.Owner, Path: u.Path}
	if resp, err := s.callTimeout(ctx, addr, listReq, filesCallTimeout); err == nil {
		for _, e := range resp.Entries {
			taken[strings.ToLower(e.Name)] = true
		}
	}
	var conflicts []string
	for _, it := range items {
		if it.top && taken[strings.ToLower(it.name)] {
			conflicts = append(conflicts, it.name)
		}
	}
	if len(conflicts) > 0 && u.OnConflict == "" {
		sort.Strings(conflicts)
		return UploadResult{Conflicts: conflicts}, nil
	}

	var (
		res    UploadResult
		done   int64
		states = map[int]*groupState{}
		emit   = s.transferEmitter(u.TransferID, "upload")
	)
	fail := func(path string, err error) {
		res.Failed = append(res.Failed, UploadFailure{Path: path, Error: err.Error()})
	}
	emit(0, total, "running", "")

	for _, it := range items {
		if ctx.Err() != nil {
			break
		}
		var st *groupState
		if it.top {
			st = &groupState{name: it.name}
			states[it.group] = st
			if taken[strings.ToLower(it.name)] {
				switch u.OnConflict {
				case protocol.ConflictSkip:
					st.skip = true
					res.Skipped++
					continue
				case protocol.ConflictRename:
					st.name = nextFreeName(taken, it.name, it.isDir)
				case protocol.ConflictReplace:
					st.replace = true
				}
			}
			taken[strings.ToLower(st.name)] = true
		} else {
			st = states[it.group]
		}
		if st == nil || st.skip || st.failed {
			continue
		}

		var parentRemote, name string
		if it.top {
			parentRemote, name = u.Path, st.name
		} else {
			parentRemote, name = joinRemote(joinRemote(u.Path, st.name), it.dir), it.name
		}
		label := joinRemote(parentRemote, name)

		if it.isDir {
			mk := protocol.FilesRequest{
				Op: protocol.FilesOpMkdir, SessionID: sess.SessionID, Owner: u.Owner, Path: parentRemote, Name: name,
			}
			if _, err := s.callTimeout(ctx, addr, mk, filesCallTimeout); err != nil {
				var fe *p2ptransport.FilesError
				exists := errors.As(err, &fe) && fe.Code == protocol.FilesErrExists
				// Существующая папка при «заменить» — слияние; вложенные папки уже слиты.
				if !(exists && (!it.top || st.replace)) {
					fail(label, err)
					st.failed = true
				}
			}
			continue
		}

		f, err := os.Open(it.local)
		if err != nil {
			fail(it.local, err)
			continue
		}
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			_ = f.Close()
			fail(it.local, errors.New("not a regular file"))
			continue
		}
		size := info.Size()
		if size > maxUploadFileBytes {
			_ = f.Close()
			fail(label, errors.New("file is too large (max 2 GiB)"))
			continue
		}
		policy := u.OnConflict
		if it.top {
			policy = ""
			if st.replace {
				policy = protocol.ConflictReplace
			}
		}
		req := protocol.FilesRequest{
			Op: protocol.FilesOpUpload, SessionID: sess.SessionID, Owner: u.Owner,
			Path: parentRemote, Name: name, Size: size, OnConflict: policy,
		}
		base := done
		resp, err := s.node.FilesUpload(ctx, addr, req, f,
			func(d, _ int64) { emit(base+d, total, "running", "") })
		_ = f.Close()
		if err != nil {
			fail(label, err)
			continue
		}
		if resp.Skipped > 0 {
			res.Skipped++
		} else {
			res.Uploaded++
			if it.top && resp.Entry != nil {
				res.Items = append(res.Items, *resp.Entry)
			}
		}
		done += size
	}

	if err := ctx.Err(); err != nil {
		emit(done, total, "error", "cancelled")
		return res, err
	}
	emit(done, total, "done", "")
	return res, nil
}

// ---------- контакты и блокировки -> сервер ----------

var (
	filesSyncMu   sync.Mutex
	filesListsVer uint64 // версия corechat, с которой списки успешно отправлены
)

// pushFileLists отправляет серверу списки контактов и блокировок: он нужен
// ему для прав «только контактам» и чтобы не принимать файлы от заблокированных.
// Отправка идёт в фоне; одновременные отправки выстраиваются в очередь, и
// каждая шлёт самое свежее состояние.
func (s *Service) pushFileLists() {
	go func() {
		filesSyncMu.Lock()
		defer filesSyncMu.Unlock()

		sess, addr, err := s.filesSession()
		if err != nil {
			return
		}
		ver := corechat.Version()
		contacts, err := corechat.ListContacts()
		if err != nil {
			return
		}
		blocked, err := corechat.ListBlocked()
		if err != nil {
			return
		}
		var cl, bl []string
		for _, c := range contacts {
			if c.UserID != "" {
				cl = append(cl, c.UserID)
			}
		}
		for _, b := range blocked {
			if b.UserID != "" {
				bl = append(bl, b.UserID)
			}
		}

		ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
		defer cancel()
		_, err1 := s.node.FilesCall(ctx, addr, protocol.FilesRequest{
			Op: protocol.FilesOpContactsPut, SessionID: sess.SessionID, Contacts: cl,
		})
		_, err2 := s.node.FilesCall(ctx, addr, protocol.FilesRequest{
			Op: protocol.FilesOpBlockedPut, SessionID: sess.SessionID, Blocked: bl,
		})
		if err1 != nil || err2 != nil {
			fmt.Printf("files: lists sync failed: contacts=%v blocked=%v\n", err1, err2)
			return
		}
		filesListsVer = ver
	}()
}

// resyncFileListsIfStale повторяет отправку, если прошлая не удалась или списки изменились.
func (s *Service) resyncFileListsIfStale() {
	filesSyncMu.Lock()
	stale := corechat.Version() != filesListsVer
	filesSyncMu.Unlock()
	if stale {
		s.pushFileLists()
	}
}
