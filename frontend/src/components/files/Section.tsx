import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { formatBytes } from "../../files/format";
import { iconUrl } from "../../files/icons";
import { canDo } from "../../files/perm";
import type { FileEntry, QuotaInfo } from "../../files/types";
import { SECTION_TITLES, type SectionId } from "../../files/uiState";
import { apiOwner, useSectionTree, type Row } from "../../files/useSectionTree";
import { useFilesCtx } from "./FilesContext";
import { useSectionActions } from "./useSectionActions";

import { NO_SELECTION, type Selection } from "../../files/selection";

interface Props {
  id: SectionId;
  paneId: string | null;
  collapsed: boolean;
  dragging: boolean;
  dropMark: "before" | "after" | null;
  selection: Selection;
  onSelection: (s: Selection) => void;
notify: (msg: string, kind?: "info" | "error") => void;
  refreshSignal: number;
  registerEl: (id: SectionId, el: HTMLElement | null) => void;
  onHeaderPointerDown: (e: ReactPointerEvent, id: SectionId) => void;
  onHeaderContextMenu: (e: ReactMouseEvent) => void;
  onToggleCollapsed: () => void;
}

const EMPTY_TEXT: Record<SectionId, string> = {
  mine: "Папка пуста",
  favorites: "Здесь появятся файлы и папки, добавленные в избранное",
  server: "Нет доступных папок",
};



function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`fx-chev-svg${open ? " open" : ""}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RenameInput({
  initial,
  isDir,
  onCommit,
  onCancel,
}: {
  initial: string;
  isDir: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = isDir ? -1 : initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value === null) onCancel();
    else onCommit(value);
  };

  return (
    <input
      ref={ref}
      className="fx-rename"
      defaultValue={initial}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function QuotaBar({ generation }: { generation: number }) {
  const [q, setQ] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    let off = false;
    filesApi
      .quota()
      .then((v) => {
        if (!off) setQ(v ?? null);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [generation]);

  if (!q) return null;
  const pct = q.unlimited || q.limit_bytes <= 0 ? 0 : Math.min(100, (q.used_bytes / q.limit_bytes) * 100);
  const level = pct >= 95 ? " danger" : pct >= 80 ? " warn" : "";

  return (
    <div className="fx-quota">
      {q.unlimited ? (
        <span>Занято {formatBytes(q.used_bytes)} · без ограничений</span>
      ) : (
        <>
          <span>
            Занято {formatBytes(q.used_bytes)} из {formatBytes(q.limit_bytes)}
          </span>
          <div className="fx-quota-bar">
            <div className={`fx-quota-fill${level}`} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

export function Section({
  id,
  paneId,
  collapsed,
  dragging,
  dropMark,
  selection,
  onSelection,
  notify,
  refreshSignal,
  registerEl,
  onHeaderPointerDown,
  onHeaderContextMenu,
  onToggleCollapsed,
}: Props) {
  const tree = useSectionTree(id);
    const ctx = useFilesCtx();
  const [editing, setEditing] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { rows } = tree;

  const selected = useMemo(
    () => new Set(selection.section === id ? selection.keys : []),
    [selection, id],
  );
    const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected]);
  const rootEntry = useMemo<FileEntry>(
    () => ({ name: "Моя папка", path: "", is_dir: true, size: 0, mod_time: 0, owner: "", owner_name: "" }),
    [],
  );
  const actions = useSectionActions({
    id,
    tree,
    selectedRows,
    selectedKeys: selected,
    select,
    clear: () => onSelection(NO_SELECTION),
    setEditing,
    startRename,
    notify,
    rootEntry,
    paneId,
  });

  useEffect(() => {
    if (id === "favorites" && ctx.favVersion > 0) void tree.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.favVersion]);
  useEffect(() => {
    if (refreshSignal > 0) void tree.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  function select(keys: string[], anchor: string | null) {
    onSelection({ section: id, keys, anchor });
  }

  async function toggleRow(entry: FileEntry) {
    const msg = await tree.toggle(entry);
    if (msg) notify(msg);
  }

  function handleRowClick(e: ReactMouseEvent, row: Row, index: number) {
    bodyRef.current?.focus();
    const additive = e.ctrlKey || e.metaKey;

    if (e.shiftKey && selection.section === id && selection.anchor) {
      const a = rows.findIndex((r) => r.key === selection.anchor);
      if (a >= 0) {
        const [from, to] = a < index ? [a, index] : [index, a];
        const range = rows.slice(from, to + 1).map((r) => r.key);
        select(additive ? Array.from(new Set([...selected, ...range])) : range, selection.anchor);
        return;
      }
    }
    if (additive) {
      const next = new Set(selected);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      select(Array.from(next), row.key);
      return;
    }
    select([row.key], row.key);
    if (row.entry.is_dir && e.detail <= 1) void toggleRow(row.entry);
  }

  async function commitRename(entry: FileEntry, name: string) {
    setEditing(null);
    const next = name.trim();
    if (!next || next === entry.name) return;
    if (/[\\/]/.test(next)) {
      notify("Имя не может содержать / или \\");
      return;
    }
    try {
      const renamed = await filesApi.rename(apiOwner(id, entry), entry.path, next);
      if (renamed) {
        const key = `${renamed.owner}\u0000${renamed.path}`;
        select([key], key);
      }
    } catch (err) {
      notify(describeFileError(err));
    }
    void tree.reload();
  }
    function startRename(row: Row) {
    if ((id === "server" && row.depth === 0) || !canDo(ctx.me, id, row.entry, "rename")) {
      notify("Нет права на переименование");
      return;
    }
    setEditing(row.key);
  }
    function openRow(row: Row) {
    const e = row.entry;
    if (e.is_dir || !e.name.toLowerCase().endsWith(".txt")) return; // открыть можно только .txt
    if (!canDo(ctx.me, id, e, "open")) {
      notify("Нет права на просмотр");
      return;
    }
    ctx.openFile(e, id, canDo(ctx.me, id, e, "edit"));
  }
     async function deleteSelected() {
    const picked = selectedRows;
    if (picked.length === 0) return;

    if (id === "favorites") {
      // Это ссылки: клавиша убирает из избранного, сам файл не трогает.
      const roots = picked.filter((r) => r.depth === 0);
      if (roots.length === 0) {
        notify("Из избранного можно убрать только добавленные элементы");
        return;
      }
      const res = await Promise.allSettled(roots.map((r) => filesApi.favRemove(r.entry.owner, r.entry.path)));
      const failed = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) notify(describeFileError(failed.reason));
      onSelection(NO_SELECTION);
      void tree.reload();
      ctx.refreshFavs();
      return;
    }

    await actions.removeReal(picked);
  }

  function moveCursor(delta: number) {
    if (rows.length === 0) return;
    const cur = selection.section === id && selection.anchor ? rows.findIndex((r) => r.key === selection.anchor) : -1;
    const next = Math.max(0, Math.min(rows.length - 1, cur < 0 ? 0 : cur + delta));
    select([rows[next].key], rows[next].key);
    requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (editing) return;
    const picked = rows.filter((r) => selected.has(r.key));
    const cur = picked.length === 1 ? picked[0] : null;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveCursor(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveCursor(-1);
        break;
      case "ArrowRight":
        if (cur?.entry.is_dir && !cur.expanded) {
          e.preventDefault();
          void toggleRow(cur.entry);
        }
        break;
      case "ArrowLeft":
        if (cur?.entry.is_dir && cur.expanded) {
          e.preventDefault();
          void toggleRow(cur.entry);
        }
        break;
            case "Enter":
        if (cur?.entry.is_dir) {
          e.preventDefault();
          void toggleRow(cur.entry);
        } else if (cur) {
          e.preventDefault();
          openRow(cur);
        }
        break;
      case "Delete":
        e.preventDefault();
        void deleteSelected();
        break;
      case "a":
      case "A":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          select(rows.map((r) => r.key), rows[0]?.key ?? null);
        }
        break;
      case "Escape":
        onSelection(NO_SELECTION);
        break;
      default:
        break;
    }
  }

  const cls = `fx-sec ${collapsed ? "closed" : "open"}${dragging ? " dragging" : ""}${dropMark ? ` drop-${dropMark}` : ""}`;

  return (
    <section ref={(el) => registerEl(id, el)} className={cls}>
      <header
        className="fx-sec-head"
        onPointerDown={(e) => onHeaderPointerDown(e, id)}
        onClick={onToggleCollapsed}
        onContextMenu={onHeaderContextMenu}
      >
        <Chevron open={!collapsed} />
        <span className="fx-sec-title">{SECTION_TITLES[id]}</span>
      </header>

      {!collapsed && (
        <>
          <div
            ref={bodyRef}
            className="fx-body"
            tabIndex={0}
            role="tree"
            onKeyDown={onKeyDown}
            onContextMenu={actions.bodyMenu}
            onClick={(e) => {
              if (e.target === e.currentTarget) onSelection(NO_SELECTION);
            }}
          >
            {tree.status === "loading" && rows.length === 0 && <div className="fx-hint">Загрузка…</div>}
            {tree.status === "error" && (
              <div className="fx-hint">
                {tree.error}
                <button type="button" className="fx-link" onClick={() => void tree.reload()}>
                  Повторить
                </button>
              </div>
            )}
            {tree.status === "ready" && rows.length === 0 && <div className="fx-hint">{EMPTY_TEXT[id]}</div>}

            {tree.status !== "error" &&
              rows.map((row, index) => (
                <div
                  key={row.key}
                  data-index={index}
                  role="treeitem"
                  aria-selected={selected.has(row.key)}
                  aria-expanded={row.entry.is_dir ? row.expanded : undefined}
                  className={`fx-row${selected.has(row.key) ? " sel" : ""}`}
                  style={{ paddingLeft: 6 + row.depth * 14 }}
                  onContextMenu={(e) => actions.rowMenu(e, row)}
                  onDoubleClick={() => openRow(row)}
                  onClick={(e) => handleRowClick(e, row, index)}
                >
                  <span
                    className={`fx-chev${row.entry.is_dir ? "" : " none"}`}
                    onClick={(e) => {
                      if (!row.entry.is_dir) return;
                      e.stopPropagation();
                      void toggleRow(row.entry);
                    }}
                  >
                    <Chevron open={row.expanded} />
                  </span>
                  <img
                    className="fx-icon"
                    src={iconUrl(row.entry.name, row.entry.is_dir, row.expanded)}
                    alt=""
                    draggable={false}
                  />
                  {editing === row.key ? (
                    <RenameInput
                      initial={row.entry.name}
                      isDir={row.entry.is_dir}
                      onCommit={(name) => void commitRename(row.entry, name)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span className="fx-name" title={row.entry.name}>
                      {row.entry.name}
                    </span>
                  )}
                  {row.loading && <span className="fx-spin" />}
                </div>
              ))}
          </div>
          {id === "mine" && <QuotaBar generation={tree.generation} />}
        </>
      )}
    </section>
  );
}