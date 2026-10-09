import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { isJunkName } from "../../files/hidden";
import { iconUrl } from "../../files/icons";
import { sendServerFiles } from "../../files/sendAttachment";
import type { FileEntry } from "../../files/types";
import { loadBootstrap } from "../../lib/api";
import type { ChatSummary } from "../../types";

export interface SendTarget {
  entry: FileEntry;
  /** Как ждёт API ("" — свой файл). */
  owner: string;
}

interface Props {
  open: boolean;
  mode: "search" | "send";
  target: SendTarget | null;
  focusToken: number;
  onOpen: () => void;
  onClose: () => void;
  onOpenResult: (e: FileEntry) => void;
  onReveal: (e: FileEntry) => void;
  notify: (msg: string, kind?: "info" | "error") => void;
}

const isTxt = (e: FileEntry) => !e.is_dir && e.name.toLowerCase().endsWith(".txt");

export function SearchBar({ open, mode, target, focusToken, onOpen, onClose, onOpenResult, onReveal, notify }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, focusToken]);

  // Новый режим или новый файл для отправки: чистый лист.
  useEffect(() => {
    setQuery("");
    setCursor(0);
    setPicked(new Set());
    setResults([]);
    setError("");
  }, [mode, target]);

  // Список чатов для «Отправить».
  useEffect(() => {
    if (!open || mode !== "send") return;
    let off = false;
    loadBootstrap()
      .then((s) => {
        if (!off) setChats([...(s.chats ?? [])].sort((a, b) => b.last_timestamp - a.last_timestamp));
      })
      .catch((e) => {
        if (!off) setError(describeFileError(e));
      });
    return () => {
      off = true;
    };
  }, [open, mode, target]);

  // Поиск: имена и содержимое .txt. «Избранное» сервер не ищет.
  useEffect(() => {
    if (!open || mode !== "search") return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      filesApi
        .search(q, { content: true, limit: 50 })
        .then((r) => {
          if (my !== seq.current) return;
          setResults(r.entries.filter((e) => !isJunkName(e.name)));
          setTruncated(r.truncated);
          setError("");
          setCursor(0);
        })
        .catch((err) => {
          if (my === seq.current) setError(describeFileError(err));
        })
        .finally(() => {
          if (my === seq.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, open, mode]);

  // Клик вне окна закрывает.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose]);

  const recipients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? chats.filter((c) => (c.title || c.peer_id).toLowerCase().includes(q)).slice(0, 8)
      : chats.slice(0, 5);
  }, [chats, query]);

  function activate(r: FileEntry) {
    if (isTxt(r)) onOpenResult(r);
    else onReveal(r);
    onClose();
  }

  function toggle(c: ChatSummary) {
    if (!c.peer_user_id) return;
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(c.chat_id)) next.delete(c.chat_id);
      else next.add(c.chat_id);
      return next;
    });
  }

    async function doSend() {
    if (!target || picked.size === 0 || sending) return;
    setSending(true);
    let ok = 0;
    const failed: string[] = [];
    for (const chat of chats.filter((c) => picked.has(c.chat_id))) {
      const r = await sendServerFiles(
        { chat_id: chat.chat_id, peer_id: chat.peer_id, peer_user_id: chat.peer_user_id },
        [{ owner: target.owner, entry: target.entry }],
      );
      ok += r.sent;
      for (const e of r.errors) failed.push(`${chat.title || chat.peer_id}: ${e}`);
    }
    setSending(false);
    if (failed.length > 0) notify(`Не отправлено: ${failed.join("; ")}`);
    else notify(`Отправлено: ${ok}`, "info");
    if (ok > 0 || failed.length === 0) onClose();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    const n = mode === "search" ? results.length : recipients.length;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (n ? (c + 1) % n : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (n ? (c - 1 + n) % n : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "search") {
        const r = results[cursor];
        if (r) activate(r);
      } else if (e.ctrlKey || e.metaKey) {
        void doSend();
      } else {
        const c = recipients[cursor];
        if (c) toggle(c);
      }
    }
  }

  return (
    <div ref={wrapRef} className="fx-searchwrap">
      <input
        ref={inputRef}
        className="fx-search"
        value={query}
        spellCheck={false}
        placeholder={
          mode === "send" && target
            ? `Отправить «${target.entry.name}»: выберите получателей`
            : "Поиск по именам и содержимому .txt (Ctrl+F)"
        }
        onFocus={onOpen}
        onClick={onOpen}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {open && (
        <div className="fx-drop">
          {mode === "search" ? (
            <>
              {!query.trim() && (
                <div className="fx-hint">Ищем в «Моей папке» и «Сервере». «Избранное» в поиске не участвует.</div>
              )}
              {loading && <div className="fx-hint">Поиск…</div>}
              {error && <div className="fx-hint">{error}</div>}
              {!loading && !error && query.trim() && results.length === 0 && <div className="fx-hint">Ничего не найдено</div>}
              {results.map((r, i) => (
                <div
                  key={`${r.owner}\u0000${r.path}`}
                  className={`fx-result${i === cursor ? " cur" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => activate(r)}
                >
                  <img className="fx-icon" src={iconUrl(r.name, r.is_dir)} alt="" draggable={false} />
                  <div className="fx-result-main">
                    <div className="fx-result-name">{r.name}</div>
                    <div className="fx-result-path">{`${r.owner_name || r.owner}/${r.path}`}</div>
                    {r.snippet && <div className="fx-result-snippet">{r.snippet}</div>}
                  </div>
                  <button
                    type="button"
                    className="fx-icon-btn"
                    title="Показать в дереве"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReveal(r);
                      onClose();
                    }}
                  >
                    ↗
                  </button>
                </div>
              ))}
              {truncated && <div className="fx-hint">Показаны первые результаты, уточните запрос</div>}
            </>
          ) : (
            <>
              <div className="fx-drop-title">Получатели</div>
              {error && <div className="fx-hint">{error}</div>}
              {recipients.length === 0 && !error && <div className="fx-hint">Нет подходящих чатов</div>}
              {recipients.map((c, i) => {
                const can = !!c.peer_user_id;
                return (
                  <label
                    key={c.chat_id}
                    className={`fx-result${i === cursor ? " cur" : ""}${can ? "" : " disabled"}`}
                    onMouseEnter={() => setCursor(i)}
                  >
                    <input type="checkbox" disabled={!can} checked={picked.has(c.chat_id)} onChange={() => toggle(c)} />
                    <div className="fx-result-main">
                      <div className="fx-result-name">{c.title || c.peer_id}</div>
                      {!can && <div className="fx-result-path">нет аккаунта, файл отправить нельзя</div>}
                    </div>
                  </label>
                );
              })}
              <div className="fx-drop-actions">
                <span className="fx-modal-count">Выбрано: {picked.size} · Ctrl+Enter</span>
                <button type="button" className="fx-btn primary" disabled={picked.size === 0 || sending} onClick={() => void doSend()}>
                  {sending ? "Отправка…" : "Отправить"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}