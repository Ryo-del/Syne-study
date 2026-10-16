import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { filesApi } from "../../files/api";
import { ApiError } from "../../lib/api";
import type { FileEntry, UploadResult } from "../../files/types";
import { formatBytes } from "../../files/format";
import { iconUrl } from "../../files/icons";

type Source = "mine" | "server";
interface Location { label: string; owner: string; path: string; group?: string }
interface WorkspaceChange { path: string; status: string; bytes: number; digest: string; target_path: string; base_mod_time: number }

function safeSegment(value: string) {
  return value.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "_") || "file";
}

/* ─── Иконки (в стиле FilesIcon: 24x24, stroke 1.6) ─── */

type IconProps = { size?: number };
function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}
export const WorkspaceIcon = (p: IconProps) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17M9 9.5v10" /></Svg>;
const FolderIcon = (p: IconProps) => <Svg {...p}><path d="M4 6.5C4 5.67 4.67 5 5.5 5H10l2 2h6.5c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-13C4.67 19 4 18.33 4 17.5v-11Z" /></Svg>;
const UpIcon = (p: IconProps) => <Svg {...p}><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" /></Svg>;
const RefreshIcon = (p: IconProps) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5" /></Svg>;
const DownloadIcon = (p: IconProps) => <Svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></Svg>;
const UploadIcon = (p: IconProps) => <Svg {...p}><path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14" /></Svg>;
const OpenFolderIcon = (p: IconProps) => <Svg {...p}><path d="M4 18.5V6.5C4 5.67 4.67 5 5.5 5H10l2 2h6.5c.83 0 1.5.67 1.5 1.5V11" /><path d="M4 18.5 6.3 12.5c.2-.5.7-.8 1.2-.8H21l-2.4 6.3c-.2.5-.7.7-1.2.7H4Z" /></Svg>;
const CodeIcon = (p: IconProps) => <Svg {...p}><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" /></Svg>;
const CloseIcon = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
const ChevronIcon = (p: IconProps) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>;
const LockIcon = (p: IconProps) => <Svg {...p}><rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></Svg>;

function statusTone(status: string) {
  const value = status.trim();
  if (value === "Есть ошибки") return "danger";
  if (value === "Загрузка" || value === "Подготовка") return "busy";
  if (value === "Есть изменения" || value === "Ожидает загрузки") return "warn";
  if (value === "Загружено") return "ok";
  return "idle";
}
function changeTone(status: string) {
  if (status === "Новый") return "new";
  if (status === "Изменён") return "mod";
  if (status === "Удалён") return "del";
  return "idle";
}

export function WorkspacePanel({ onClose, notify }: { onClose: () => void; notify: (message: string, kind?: "info" | "error") => void }) {
  const [source, setSource] = useState<Source>("mine");
  const [location, setLocation] = useState<Location>({ label: "Моя папка", owner: "", path: "" });
  const [rows, setRows] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Map<string, FileEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Готова к работе");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [changes, setChanges] = useState<WorkspaceChange[]>([]);
  const pendingCount = changes.filter((c) => c.status === "Новый" || c.status === "Изменён").length;
  const isTransientOrResult = ["Загрузка", "Подготовка", "Ожидает загрузки", "Есть ошибки", "Загружено"].includes(status);
  const shownStatus = !isTransientOrResult && pendingCount ? "Есть изменения" : status;
  const canGoUp = Boolean(location.path || location.owner || location.group);

  async function refreshChanges() {
    if (isTauri()) {
      try { setChanges((await invoke<{ changes: WorkspaceChange[] }>("workspace_diff")).changes); }
      catch (error) { notify(String(error)); }
    }
  }

  useEffect(() => {
    if (isTauri()) void invoke<string>("get_workspace_dir").then(setLocalPath).catch((e) => console.error(e));
    void refreshChanges();
  }, []);

  async function load(loc = location, src = source) {
    setLoading(true);
    try {
      const result = loc.group
        ? await filesApi.listGroup(loc.group)
        : src === "server" && !loc.owner
          ? await filesApi.listOwners()
          : (await filesApi.list(loc.owner, loc.path)).entries;
      setRows(result);
    } catch (error) { notify(String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(location, source); }, [location, source]);

  function switchSource(next: Source) {
    setSource(next); setSelected(new Map()); setLocation({ label: next === "mine" ? "Моя папка" : "Сервер", owner: "", path: "" });
  }
  function enter(entry: FileEntry) {
    if (!entry.is_dir) return;
    setSelected(new Map());
    setLocation({ label: entry.name, owner: entry.owner, path: entry.path, ...(entry.is_group ? { group: entry.group || entry.name } : {}) });
  }
  function goUp() {
    if (location.group) { setLocation({ label: "Сервер", owner: "", path: "" }); return; }
    if (!location.path && location.owner && source === "server") { setLocation({ label: "Сервер", owner: "", path: "" }); return; }
    const parts = location.path.split("/").filter(Boolean);
    parts.pop();
    const path = parts.join("/");
    setLocation({ label: parts[parts.length - 1] || (source === "mine" ? "Моя папка" : "Сервер"), owner: location.owner, path });
  }
  function toggle(entry: FileEntry) {
    const key = `${entry.owner}\0${entry.path}`;
    setSelected((old) => { const next = new Map(old); next.has(key) ? next.delete(key) : next.set(key, entry); return next; });
  }

  async function downloadFile(entry: FileEntry, relative: string, owner: string, targetPath: string) {
    const slash = relative.lastIndexOf("/");
    const relDir = slash < 0 ? "" : relative.slice(0, slash);
    const dir = await invoke<string>("workspace_subdir", { relative: relDir });
    const result = await filesApi.download({ owner, path: entry.path, dir: false, dest_dir: dir, transfer_id: crypto.randomUUID() });
    if (result.bytes !== entry.size) throw new Error(`Размер скачанного файла ${entry.name} не совпадает с серверным`);
    let baseModTime = 0;
    try {
      const existing = await filesApi.stat("", targetPath);
      if (existing) {
        if (existing.is_dir) throw new Error(`В «Моей папке» по пути «${targetPath}» находится папка`);
        baseModTime = existing.mod_time;
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "not_found")) throw error;
    }
    await invoke("record_workspace_file", { path: result.path, targetPath, baseModTime });
  }
  async function downloadTree(entry: FileEntry, relative: string, owner: string, targetPath: string) {
    if (!entry.is_dir) { await downloadFile(entry, relative, owner, source === "mine" ? entry.path : targetPath); return 1; }
    await invoke<string>("workspace_subdir", { relative });
    let listing: FileEntry[];
    if (entry.is_group) listing = await filesApi.listGroup(entry.group || entry.name);
    else {
      const result = await filesApi.list(owner, entry.path);
      if (result.truncated) throw new Error(`Список папки «${entry.name}» обрезан сервером; скачивание остановлено, чтобы не создать неполную копию`);
      listing = result.entries;
    }
    let count = 0;
    for (const child of listing) {
      if (child.is_dir) {
        const subOwner = child.owner || owner;
        count += await downloadTree(child, `${relative}/${safeSegment(child.name)}`, subOwner, source === "mine" ? child.path : `${targetPath}/${safeSegment(child.name)}`);
      } else if (child.can?.download !== false) {
        await downloadFile(child, `${relative}/${safeSegment(child.name)}`, child.owner || owner, source === "mine" ? child.path : `${targetPath}/${safeSegment(child.name)}`);
        count += 1;
      }
    }
    return count;
  }
  async function downloadSelected() {
    if (selected.size === 0 || !isTauri()) return;
    setBusy(true); setStatus("Подготовка");
    let downloaded = 0;
    const errors: string[] = [];
    for (const entry of selected.values()) {
      if (!entry.is_dir && entry.can?.download === false) { errors.push(`${entry.name}: нет права на скачивание`); continue; }
      try { downloaded += await downloadTree(entry, safeSegment(entry.name), entry.owner || location.owner, source === "mine" ? entry.path : safeSegment(entry.name)); }
      catch (error) { errors.push(`${entry.name}: ${String(error)}`); }
    }
    setBusy(false); setStatus(errors.length ? "Есть ошибки" : "Готова к работе");
    setSelected(new Map());
    await refreshChanges();
    notify(`В workspace скачано файлов: ${downloaded}${errors.length ? `. Ошибки: ${errors.join("; ")}` : ""}`, errors.length ? "error" : "info");
  }
  async function uploadWorkspace() {
    if (!isTauri()) return;
    setBusy(true); setStatus("Загрузка"); setUploadResult(null);
    try {
      const diff = (await invoke<{ changes: WorkspaceChange[] }>("workspace_diff")).changes;
      setChanges(diff);
      const pending = diff.filter((change) => change.status === "Новый" || change.status === "Изменён");
      if (!pending.length) { setStatus("Готова к работе"); notify("Новых или изменённых файлов нет", "info"); return; }
      const preview = diff.map((change) => `${change.status}: ${change.path}${change.bytes ? ` (${formatBytes(change.bytes)})` : ""}`).join("\n");
      if (!window.confirm(`Выгрузить изменения в «Мою папку»:\n\n${preview}\n\nСкачанные файлы будут заменены на сервере, если их версия не менялась. Новые файлы получат свободное имя. Удалённые локально файлы на сервере останутся.`)) { setStatus("Готова к работе"); return; }
      const failures: { path: string; error: string }[] = [];
      let uploaded = 0;
      for (const change of pending) {
        try {
          const targetPath = change.target_path || change.path;
          const segments = targetPath.split("/");
          const fileName = segments.pop()!;
          let parent = "";
          for (const segment of segments) {
            const entries = (await filesApi.list("", parent)).entries;
            const found = entries.find((entry) => entry.name === segment && entry.is_dir);
            if (found) parent = found.path;
            else {
              const created = await filesApi.mkdir("", parent, segment);
              parent = created?.path ?? (parent ? `${parent}/${segment}` : segment);
            }
          }
          const local = await invoke<string>("workspace_file_path", { relative: change.path });
          const result = await filesApi.upload({ owner: "", path: parent, local_paths: [local], on_conflict: change.base_mod_time ? "replace" : "rename", ...(change.base_mod_time ? { base_mod_time: change.base_mod_time } : {}), transfer_id: crypto.randomUUID() });
          if (result.failed?.length || result.uploaded !== 1) throw new Error(result.failed?.map((f) => f.error).join("; ") || "сервер не подтвердил загрузку");
          if (result.items?.[0]?.size !== change.bytes) throw new Error("Размер сохранённого на сервере файла не совпал с локальным");
          const uploadedEntry = result.items?.[0];
          await invoke("mark_workspace_uploaded", { relative: change.path, digest: change.digest, targetPath: uploadedEntry?.path || (parent ? `${parent}/${fileName}` : fileName), baseModTime: uploadedEntry?.mod_time || 0 });
          uploaded += 1;
        } catch (error) { failures.push({ path: change.path, error: String(error) }); }
      }
      const result: UploadResult = { uploaded, skipped: 0, ...(failures.length ? { failed: failures } : {}) };
      setUploadResult(result);
      setStatus(failures.length ? "Ожидает загрузки" : "Загружено");
      await refreshChanges();
      notify(`Загружено файлов: ${uploaded}${failures.length ? `; ошибок: ${failures.length}` : ""}`, failures.length ? "error" : "info");
    } catch (error) { setStatus("Ожидает загрузки"); notify(String(error)); }
    finally { setBusy(false); }
  }

  return (
    <section className="fx-ws">
      {/* ── Шапка ── */}
      <header className="fx-ws-head">
        <div className="fx-ws-title-block">
          <div className="fx-ws-title-row">
            <span className="fx-ws-title-icon"><WorkspaceIcon size={18} /></span>
            <h2>Рабочая область</h2>
            <span className={`fx-ws-pill ${statusTone(shownStatus)}`}>
              <i />{shownStatus}
            </span>
          </div>
          <div className="fx-ws-path" title={localPath}>
            {localPath || "Локальная папка доступна в приложении Syne"}
          </div>
        </div>

        <div className="fx-ws-actions">
          {isTauri() && (
            <>
              <button type="button" className="fx-ws-btn" disabled={busy}
                onClick={() => void invoke("open_workspace", { vscode: false }).catch((e) => notify(String(e)))}>
                <OpenFolderIcon /> Папка
              </button>
            </>
          )}
          <button type="button" className="fx-ws-btn primary" disabled={busy || !isTauri()} onClick={() => void uploadWorkspace()}>
            <UploadIcon /> Выгрузить на сервер
            {pendingCount > 0 && <span className="fx-ws-count">{pendingCount}</span>}
          </button>
          <button type="button" className="fx-ws-btn icon ghost" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>
      </header>

      {/* ── Панель навигации ── */}
      <div className="fx-ws-toolbar">
        <div className="fx-ws-segment" role="tablist">
          <button type="button" role="tab" aria-selected={source === "mine"} className={source === "mine" ? "active" : ""} onClick={() => switchSource("mine")}>
            Моя папка
          </button>
          <button type="button" role="tab" aria-selected={source === "server"} className={source === "server" ? "active" : ""} onClick={() => switchSource("server")}>
            Сервер
          </button>
        </div>

        <div className="fx-ws-crumb">
          <button type="button" className="fx-ws-btn icon ghost" disabled={!canGoUp} onClick={goUp} title="На уровень выше" aria-label="На уровень выше">
            <UpIcon />
          </button>
          <FolderIcon size={16} />
          <span title={location.label}>{location.label}</span>
        </div>

        <div className="fx-ws-toolbar-end">
          {isTauri() && (
            <button type="button" className="fx-ws-btn icon" disabled={busy} onClick={() => void refreshChanges()} title="Проверить изменения" aria-label="Проверить изменения">
              <RefreshIcon />
            </button>
          )}
          <button type="button" className="fx-ws-btn accent" disabled={!selected.size || busy || !isTauri()} onClick={() => void downloadSelected()}>
            <DownloadIcon /> Скачать
            {selected.size > 0 && <span className="fx-ws-count">{selected.size}</span>}
          </button>
        </div>
      </div>

      {/* ── Список ── */}
      <div className="fx-ws-list">
        {loading ? (
          <div className="fx-ws-empty">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="fx-ws-empty">Папка пуста</div>
        ) : (
          rows.map((entry) => {
            const key = `${entry.owner}\0${entry.path}`;
            const denied = !entry.is_dir && entry.can?.download === false;
            const isSel = selected.has(key);
            return (
              <div className={`fx-ws-row${isSel ? " sel" : ""}${denied ? " denied" : ""}`} key={key}>
                <input type="checkbox" checked={isSel} disabled={denied} aria-label={`Выбрать ${entry.name}`} onChange={() => toggle(entry)} />
                <button type="button" className="fx-ws-name" onClick={() => (entry.is_dir ? enter(entry) : toggle(entry))} disabled={denied}>
                  <span className={`fx-ws-ico ${entry.is_dir ? "dir" : "file"}`}>
                    <img src={iconUrl(entry.name, entry.is_dir)} alt="" draggable={false} />
                  </span>
                  <span className="fx-ws-name-text">{entry.name}</span>
                </button>
                {denied && <span className="fx-ws-tag"><LockIcon size={12} /> Нет права на скачивание</span>}
                <span className="fx-ws-meta">{entry.is_dir ? "Папка" : formatBytes(entry.size)}</span>
                <span className={`fx-ws-chev${entry.is_dir ? "" : " none"}`}><ChevronIcon size={14} /></span>
              </div>
            );
          })
        )}
      </div>

      {/* ── Ошибки выгрузки ── */}
      {uploadResult?.failed?.length ? (
        <ul className="fx-ws-errors">
          {uploadResult.failed.map((f) => <li key={`${f.path}:${f.error}`}><strong>{f.path}</strong> — {f.error}</li>)}
        </ul>
      ) : null}

      {/* ── Состояние файлов ── */}
      <div className="fx-ws-changes">
        <div className="fx-ws-changes-head">
          <span>Состояние файлов</span>
          <span className="fx-ws-count muted">{changes.length}</span>
        </div>
        {changes.length === 0 ? (
          <div className="fx-ws-changes-empty">Изменений нет</div>
        ) : (
          <div className="fx-ws-changes-list">
            {changes.map((change) => (
              <div className="fx-ws-change" key={`${change.path}:${change.status}`}>
                <span className={`fx-ws-badge ${changeTone(change.status)}`}>{change.status}</span>
                <span className="fx-ws-change-path" title={change.path}>{change.path}</span>
                {change.bytes ? <span className="fx-ws-meta">{formatBytes(change.bytes)}</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
