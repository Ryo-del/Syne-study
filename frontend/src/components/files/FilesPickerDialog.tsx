import { useEffect, useMemo, useState } from "react";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { formatBytes } from "../../files/format";
import { isJunkName } from "../../files/hidden";
import { iconUrl } from "../../files/icons";
import { canDo } from "../../files/perm";
import type { FileEntry } from "../../files/types";
import { useMe } from "../../files/useMe";

export interface PickedFile {
  /** Как ждёт API ("" — своя папка). */
  owner: string;
  entry: FileEntry;
}

type Tab = "mine" | "server";
interface Crumb {
  owner: string;
  path: string;
  title: string;
}

interface Props {
  onCancel: () => void;
  onPick: (items: PickedFile[]) => void;
}

export default function FilesPickerDialog({ onCancel, onPick }: Props) {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("mine");
  const [stack, setStack] = useState<Crumb[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Map<string, PickedFile>>(new Map());

  const ownerOf = (e: FileEntry) => (tab === "mine" ? "" : e.owner);
  const keyOf = (e: FileEntry) => `${e.owner}\u0000${e.path}`;

  useEffect(() => {
    let off = false;
    setLoading(true);
    setError("");
    const top = stack[stack.length - 1];
    const req: Promise<FileEntry[]> = top
      ? filesApi.list(top.owner, top.path).then((r) => r.entries)
      : tab === "mine"
        ? filesApi.list("", "").then((r) => r.entries)
        : filesApi.listOwners();
    req
      .then((list) => {
        if (off) return;
        setEntries(
          list
            .filter((e) => !isJunkName(e.name))
            .sort((a, b) =>
              a.is_dir === b.is_dir
                ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
                : a.is_dir
                  ? -1
                  : 1,
            ),
        );
      })
      .catch((e) => {
        if (!off) setError(describeFileError(e));
      })
      .finally(() => {
        if (!off) setLoading(false);
      });
    return () => {
      off = true;
    };
  }, [tab, stack]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
  }, [entries, filter]);

  function toggle(e: FileEntry) {
    setPicked((cur) => {
      const next = new Map(cur);
      const k = keyOf(e);
      if (next.has(k)) next.delete(k);
      else next.set(k, { owner: ownerOf(e), entry: e });
      return next;
    });
  }

  function switchTab(t: Tab) {
    setTab(t);
    setStack([]);
    setFilter("");
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel]);

  return (
    <div className="fx-modal-backdrop">
      <div className="fx-modal" role="dialog" aria-modal="true">
        <h3 className="fx-modal-title">Выберите файлы из Files</h3>

        <div className="fx-modal-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className={`fx-btn${tab === "mine" ? " primary" : ""}`} onClick={() => switchTab("mine")}>
            Моя папка
          </button>
          <button type="button" className={`fx-btn${tab === "server" ? " primary" : ""}`} onClick={() => switchTab("server")}>
            Сервер
          </button>
          {stack.length > 0 && (
            <button type="button" className="fx-btn" onClick={() => setStack((s) => s.slice(0, -1))}>
              ← {stack[stack.length - 1].title}
            </button>
          )}
        </div>

        <input
          className="fx-input"
          placeholder="Фильтр по имени"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="fx-picker-list">
          {loading && <div className="fx-hint">Загрузка…</div>}
          {error && <div className="fx-hint">{error}</div>}
          {!loading && !error && shown.length === 0 && <div className="fx-hint">Здесь пусто</div>}
          {shown.map((e) => {
            const sendable = !e.is_dir && canDo(me, tab, e, "send");
            return (
              <label
                key={keyOf(e)}
                className="fx-picker-row"
                style={e.is_dir || sendable ? undefined : { opacity: 0.5, cursor: "default" }}
                onClick={(ev) => {
                  if (e.is_dir) {
                    ev.preventDefault();
                    setStack((s) => [...s, { owner: ownerOf(e), path: e.path, title: e.name }]);
                    setFilter("");
                  }
                }}
              >
                {e.is_dir ? (
                  <span style={{ width: 16 }} />
                ) : (
                  <input type="checkbox" disabled={!sendable} checked={picked.has(keyOf(e))} onChange={() => toggle(e)} />
                )}
                <img className="fx-icon" src={iconUrl(e.name, e.is_dir)} alt="" draggable={false} />
                <span className="fx-picker-name">{e.name}</span>
                {!e.is_dir && <span className="fx-picker-login">{formatBytes(e.size)}</span>}
              </label>
            );
          })}
        </div>

        <div className="fx-modal-actions">
          <span className="fx-modal-count">Выбрано: {picked.size}</span>
          <button type="button" className="fx-btn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="fx-btn primary"
            disabled={picked.size === 0}
            onClick={() => onPick(Array.from(picked.values()))}
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}