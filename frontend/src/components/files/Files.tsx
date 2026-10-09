import { Fragment, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { filesApi, newTransferId } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { baseName, isJunkName } from "../../files/hidden";
import { pasteAll } from "../../files/paste";
import { canDo, sameUser, type Me } from "../../files/perm";
import { NO_SELECTION, type Selection } from "../../files/selection";
import type { ConflictPolicy, FileEntry } from "../../files/types";
import {
  MIN_EXPLORER_WIDTH,
  SECTION_TITLES,
  applyDrop,
  cleanupLayout,
  newPaneWeight,
  type DropTarget,
  type SectionId,
} from "../../files/uiState";
import { docKey, useEditors, type Doc } from "../../files/useEditors";
import { useFilesUi } from "../../files/useFilesUi";
import { useMe } from "../../files/useMe";
import { apiOwner, entryKey } from "../../files/useSectionTree";
import { useTransfers } from "../../files/useTransfers";
import { ChoiceDialog } from "./ChoiceDialog";
import { ConflictDialog } from "./ConflictDialog";
import { EditorPane } from "./EditorPane";
import { Explorer } from "./Explorer";
import {
  FilesProvider,
  type ChoiceRequest,
  type ClipItem,
  type DragState,
  type DropHover,
  type DropResolver,
  type FilesCtxValue,
  type RevealRequest,
} from "./FilesContext";
import { FilesMenu, type MenuItem } from "./FilesMenu";
import { PermissionsDialog } from "./PermissionsDialog";
import { SearchBar, type SendTarget } from "./SearchBar";
import { TransferPanel } from "./TransferPanel";
import "./files.css";

const MIN_PANE_WIDTH = 150;

/** Один и тот же файл из «Моей папки» и «Избранного» должен иметь один ключ вкладки. */
function docOwner(entry: FileEntry, kind: SectionId, me: Me) {
  return kind === "mine" || sameUser(entry.owner, me.login) ? "" : entry.owner;
}

interface SearchState {
  open: boolean;
  mode: "search" | "send";
  target: SendTarget | null;
  token: number;
}

export function Files() {
  const { ui, update, ready } = useFilesUi();
  const me = useMe();
  const { state: editors, dispatch } = useEditors();
  const transfers = useTransfers();

  const rootRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const paneEls = useRef<Record<string, HTMLElement | null>>({});
  const savers = useRef(new Map<string, (key: string) => Promise<boolean>>());
  const resolvers = useRef<Partial<Record<SectionId, DropResolver>>>({});
  const justDragged = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const choiceResolve = useRef<((id: string | null) => void) | null>(null);
  const handlers = useRef<{
    resolveAt: (x: number, y: number) => DropHover | null;
    desktopDrop: (paths: string[], hover: DropHover | null) => void;
  }>({ resolveAt: () => null, desktopDrop: () => undefined });

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [dragWeights, setDragWeights] = useState<Record<string, number> | null>(null);
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [notice, setNotice] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [clipboard, setClipboard] = useState<ClipItem[]>([]);
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set());
  const [favVersion, setFavVersion] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [conflict, setConflict] = useState<{ name: string; resolve: (p: ConflictPolicy | null) => void } | null>(null);
  const [choice, setChoice] = useState<ChoiceRequest | null>(null);
  const [perm, setPerm] = useState<{ owner: string; path: string; name: string; isDir: boolean } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string } | null>(null);
  const [dropHover, setDropHover] = useState<DropHover | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [search, setSearch] = useState<SearchState>({ open: false, mode: "search", target: null, token: 0 });

  // Набор избранного нужен пунктам «Добавить / Убрать из избранного» во всех разделах.
  useEffect(() => {
    let off = false;
    filesApi
      .favList()
      .then((list) => {
        if (!off) setFavKeys(new Set(list.map(entryKey)));
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [favVersion, refreshSignal]);

  // Ctrl+F: поиск Monaco, если фокус в редакторе; иначе наш search bar (только когда Files на экране).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      const root = rootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      if ((e.target as HTMLElement | null)?.closest(".monaco-editor")) return;
      e.preventDefault();
      setSearch((s) => ({ ...s, open: true, token: s.token + 1 }));
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  // Нативный drag-and-drop с рабочего стола (Tauri). Позиция приходит в физических пикселях.
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | null = null;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "leave") {
          setHover(null);
          return;
        }
        const dpr = window.devicePixelRatio || 1;
        const hover = handlers.current.resolveAt(p.position.x / dpr, p.position.y / dpr);
        if (p.type === "drop") {
          setHover(null);
          handlers.current.desktopDrop(p.paths, hover);
        } else {
          setHover(hover);
        }
      })
      .then((u) => {
        if (cancelled) u();
        else off = u;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  function setHover(h: DropHover | null) {
    setDropHover((prev) =>
      prev === h || (prev && h && prev.section === h.section && prev.key === h.key && prev.ok === h.ok) ? prev : h,
    );
  }

  function notify(text: string, kind: "info" | "error" = "error") {
    setNotice({ text, kind });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }

  function askChoice(req: ChoiceRequest): Promise<string | null> {
    choiceResolve.current?.(null);
    return new Promise((resolve) => {
      choiceResolve.current = resolve;
      setChoice(req);
    });
  }

  function answerChoice(id: string | null) {
    const r = choiceResolve.current;
    choiceResolve.current = null;
    setChoice(null);
    r?.(id);
  }

  /** Если explorer занимает всё окно, освобождаем место под окна справа. */
  function ensureWorkspace() {
    if (ui.explorerWidth !== null) return;
    const w = rootRef.current?.getBoundingClientRect().width ?? 900;
    update((s) => ({ ...s, explorerWidth: Math.max(MIN_EXPLORER_WIDTH, Math.round(w * 0.38)) }));
  }

  function newEditorPane(): string {
    const id = crypto.randomUUID();
    update((s) => ({
      ...s,
      panes: [...s.panes, { id, kind: "editor", weight: newPaneWeight(s.panes) }],
    }));
    return id;
  }

  function newWindow() {
    ensureWorkspace();
    setActiveEditor(newEditorPane());
  }

  async function openFile(entry: FileEntry, kind: SectionId, editable: boolean) {
    ensureWorkspace();
    const owner = docOwner(entry, kind, me);
    const key = docKey(owner, entry.path);

    for (const [pane, st] of Object.entries(editors)) {
      if (st.docs.some((d) => d.key === key)) {
        dispatch({ t: "activate", pane, key });
        setActiveEditor(pane);
        return;
      }
    }

    let r: Awaited<ReturnType<typeof filesApi.readText>>;
    try {
      r = await filesApi.readText(owner, entry.path);
    } catch (err) {
      notify(describeFileError(err));
      return;
    }

    let paneId =
      activeEditor && ui.panes.some((p) => p.id === activeEditor && p.kind === "editor")
        ? activeEditor
        : ui.panes.find((p) => p.kind === "editor")?.id;
    if (!paneId) paneId = newEditorPane();

    dispatch({
      t: "open",
      pane: paneId,
      doc: {
        key,
        owner,
        path: entry.path,
        name: entry.name,
        text: r.text,
        baseModTime: r.entry.mod_time,
        dirty: false,
        readOnly: !editable || r.entry.can?.edit === false,
        locked: false,
      },
    });
    setActiveEditor(paneId);
  }

  async function confirmDirty(paneId: string, docs: Doc[], title: string): Promise<boolean> {
    const dirty = docs.filter((d) => d.dirty);
    if (dirty.length === 0) return true;
    const text =
      dirty.length === 1 ? `Файл «${dirty[0].name}» изменён и не сохранён.` : `Не сохранено файлов: ${dirty.length}.`;
    const c = await askChoice({
      title,
      text,
      buttons: [
        { id: "save", label: "Сохранить", kind: "primary" },
        { id: "discard", label: "Не сохранять", kind: "danger" },
        { id: "cancel", label: "Отмена" },
      ],
    });
    if (c === null || c === "cancel") return false;
    if (c === "save") {
      const save = savers.current.get(paneId);
      for (const d of dirty) {
        if (!save || !(await save(d.key))) return false;
      }
    }
    return true;
  }

  async function closeTab(paneId: string, key: string) {
    const doc = editors[paneId]?.docs.find((d) => d.key === key);
    if (!doc) return;
    if (!(await confirmDirty(paneId, [doc], `Закрыть «${doc.name}»?`))) return;
    dispatch({ t: "close", pane: paneId, key });
  }

  async function closePane(paneId: string) {
    const pane = ui.panes.find((p) => p.id === paneId);
    if (!pane) return;
    if (pane.kind === "editor") {
      if (!(await confirmDirty(paneId, editors[paneId]?.docs ?? [], "Закрыть окно?"))) return;
      dispatch({ t: "drop", pane: paneId });
      if (activeEditor === paneId) setActiveEditor(null);
      update((s) => cleanupLayout({ ...s, panes: s.panes.filter((p) => p.id !== paneId) }));
    } else {
      // Вынесенный explorer: разделы возвращаются в общий.
      update((s) =>
        cleanupLayout({
          ...s,
          sections: s.sections.map((x) => (x.pane === paneId ? { ...x, pane: null } : x)),
          panes: s.panes.filter((p) => p.id !== paneId),
        }),
      );
    }
  }

  // ----- поиск и «показать в дереве» -----

  function closeSearch() {
    setSearch((s) => ({ ...s, open: false, mode: "search", target: null }));
  }

  function openResult(entry: FileEntry) {
    const kind: SectionId = sameUser(entry.owner, me.login) ? "mine" : "server";
    void openFile(entry, kind, canDo(me, kind, entry, "edit"));
  }

  function revealEntry(entry: FileEntry) {
    const kind: SectionId = sameUser(entry.owner, me.login) ? "mine" : "server";
    update((s) =>
      cleanupLayout({
        ...s,
        sections: s.sections.map((x) =>
          x.id === kind ? { ...x, hidden: false, collapsed: false, pane: x.hidden ? null : x.pane } : x,
        ),
      }),
    );
    setReveal({ section: kind, entry, nonce: Date.now() });
  }

  // ----- перетаскивание файлов -----

  /** Цель сброса под точкой экрана. null — мимо дерева. */
  function resolveAt(x: number, y: number): DropHover | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const body = el?.closest<HTMLElement>("[data-fx-body]");
    if (!body) return null;
    const section = body.dataset.fxBody as SectionId;
    const rowEl = el?.closest<HTMLElement>("[data-index]");
    const index = rowEl && body.contains(rowEl) ? Number(rowEl.dataset.index) : -1;
    return resolvers.current[section]?.(index) ?? null;
  }

  async function desktopDrop(paths: string[], hover: DropHover | null) {
    const list = paths.filter((p) => !isJunkName(baseName(p)));
    if (list.length === 0 || !hover) return;
    if (!hover.ok) {
      notify("Загрузка сюда запрещена: у папки нет права «вставлять»");
      return;
    }
    try {
      let r = await filesApi.upload({
        owner: hover.owner,
        path: hover.path,
        local_paths: list,
        transfer_id: newTransferId(),
      });
      if (r.conflicts && r.conflicts.length > 0) {
        const names = r.conflicts;
        const c = await askChoice({
          title: names.length === 1 ? `«${names[0]}» уже существует` : `Совпадений имён: ${names.length}`,
          text: names.slice(0, 5).join(", ") + (names.length > 5 ? "…" : ""),
          buttons: [
            { id: "replace", label: "Заменить", kind: "danger" },
            { id: "rename", label: "Переименовать" },
            { id: "skip", label: "Пропустить" },
            { id: "cancel", label: "Отмена" },
          ],
        });
        if (!c || c === "cancel") return;
        r = await filesApi.upload({
          owner: hover.owner,
          path: hover.path,
          local_paths: list,
          on_conflict: c as ConflictPolicy,
          transfer_id: newTransferId(),
        });
      }
      if (r.failed && r.failed.length > 0) {
        notify(`Не загружено: ${r.failed.length} (${r.failed[0].error})`);
      } else {
        notify(`Загружено: ${r.uploaded}${r.skipped ? `, пропущено: ${r.skipped}` : ""}`, "info");
      }
    } catch (err) {
      notify(describeFileError(err));
    }
    setRefreshSignal((n) => n + 1);
  }

  async function dropItems(kind: SectionId, entries: FileEntry[], hover: DropHover | null) {
    if (!hover) return;
    if (!hover.ok) {
      notify("Нельзя: у папки нет права «вставлять»");
      return;
    }
    if (!entries.every((e) => canDo(me, kind, e, "copy"))) {
      notify("Нельзя: нет права «копирование» у источника");
      return;
    }
    const r = await pasteAll(
      entries.map((e) => ({ owner: apiOwner(kind, e), path: e.path, name: e.name, is_dir: e.is_dir })),
      { owner: hover.owner, path: hover.path },
      (name) => new Promise<ConflictPolicy | null>((resolve) => setConflict({ name, resolve })),
      notify,
    );
    setRefreshSignal((n) => n + 1);
    if (r.skipped > 0) notify(`Пропущено элементов: ${r.skipped}`, "info");
  }

  // Перетаскивание строк между папками на pointer-событиях: нативный HTML5 DnD в Windows
  // ломается из-за нативного drop в Tauri. Это копирование: вырезания нет.
  function itemDragStart(e: ReactPointerEvent, kind: SectionId, entries: FileEntry[]) {
    if (e.button !== 0 || entries.length === 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    let hover: DropHover | null = null;
    const title = entries.length === 1 ? entries[0].name : `${entries.length} элементов`;

    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      active = true;
      hover = resolveAt(ev.clientX, ev.clientY);
      setHover(hover);
      setGhost({ x: ev.clientX, y: ev.clientY, title });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);
      setHover(null);
      setGhost(null);
      void dropItems(kind, entries, hover);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Перетаскивание заголовка раздела на pointer-событиях.
  function dragStart(e: ReactPointerEvent, id: SectionId) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const snapshot = ui;
    let active = false;
    let target: DropTarget | null = null;

    const hit = (x: number, y: number): DropTarget | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const zone = el?.closest<HTMLElement>("[data-fx-zone]")?.dataset.fxZone;
      if (!zone) return null;

      if (zone === "w") {
        let idx = snapshot.panes.length;
        for (let i = 0; i < snapshot.panes.length; i += 1) {
          const pe = paneEls.current[snapshot.panes[i].id];
          if (!pe) continue;
          const r = pe.getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            idx = i;
            break;
          }
        }
        return { kind: "new", index: idx };
      }

      const pane = zone === "e:main" ? null : zone.slice(2);
      const vis = snapshot.sections.filter((s) => !s.hidden && (s.pane ?? null) === pane);
      let idx = vis.length;
      for (let i = 0; i < vis.length; i += 1) {
        const se = sectionEls.current[vis[i].id];
        if (!se) continue;
        const r = se.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          idx = i;
          break;
        }
      }
      return { kind: "explorer", pane, index: idx };
    };

    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      active = true;
      target = hit(ev.clientX, ev.clientY);
      setDrag({ id, target });
      setGhost({ x: ev.clientX, y: ev.clientY, title: SECTION_TITLES[id] });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);
      setDrag(null);
      setGhost(null);
      const t = target;
      if (t) update((s) => cleanupLayout(applyDrop(s, id, t)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startResize(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const clamp = (clientX: number) => Math.max(MIN_EXPLORER_WIDTH, Math.min(clientX - rect.left, rect.width));

    const move = (ev: PointerEvent) => setDragWidth(clamp(ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const w = clamp(ev.clientX);
      setDragWidth(null);
      // Почти до правого края значит снова «explorer на всё окно».
      update((s) => ({ ...s, explorerWidth: w >= rect.width - 8 ? null : Math.round(w) }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startPaneResize(e: ReactPointerEvent, leftIndex: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const left = ui.panes[leftIndex];
    const right = ui.panes[leftIndex + 1];
    if (!left || !right) return;

    const widths: Record<string, number> = {};
    for (const p of ui.panes) {
      widths[p.id] = paneEls.current[p.id]?.getBoundingClientRect().width ?? p.weight;
    }
    const startX = e.clientX;
    const total = widths[left.id] + widths[right.id];
    let current = widths;

    const move = (ev: PointerEvent) => {
      const nl = Math.max(MIN_PANE_WIDTH, Math.min(widths[left.id] + (ev.clientX - startX), total - MIN_PANE_WIDTH));
      current = { ...widths, [left.id]: nl, [right.id]: total - nl };
      setDragWeights(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const done = current;
      setDragWeights(null);
      update((s) => ({
        ...s,
        panes: s.panes.map((p) => (done[p.id] ? { ...p, weight: Math.round(done[p.id]) } : p)),
      }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function workspaceMenu(e: ReactMouseEvent) {
    if ((e.target as HTMLElement).closest(".fx-pane")) return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Новое окно", onClick: () => newWindow() },
        { label: "Закрыть окно", disabled: true },
      ],
    });
  }

  // Обработчики нативного drop живут в эффекте с пустыми зависимостями, поэтому берут свежие функции отсюда.
  handlers.current = { resolveAt, desktopDrop: (paths, hover) => void desktopDrop(paths, hover) };

  if (!ready) {
    return (
      <div className="fx-root">
        <div className="fx-loading">Загрузка…</div>
      </div>
    );
  }

  const ctxValue: FilesCtxValue = {
    me,
    notify,
    clipboard,
    setClipboard,
    favKeys,
    favVersion,
    refreshFavs: () => setFavVersion((n) => n + 1),
    selection,
    setSelection,
    refreshSignal,
    refreshAll: () => setRefreshSignal((n) => n + 1),
    openMenu: (x, y, items) => setMenu({ x, y, items }),
    askConflict: (name) => new Promise<ConflictPolicy | null>((resolve) => setConflict({ name, resolve })),
    askChoice,
    openPermissions: (entry, kind) =>
      setPerm({
        owner: kind === "mine" ? "" : entry.owner,
        path: entry.path,
        name: entry.name || "Моя папка",
        isDir: entry.is_dir,
      }),
    openFile: (entry, kind, editable) => void openFile(entry, kind, editable),
    newWindow,
    closePane: (paneId) => void closePane(paneId),
    dragStart,
    wasDragging: () => justDragged.current,
    dragState: drag,
    registerSectionEl: (id, el) => {
      sectionEls.current[id] = el;
    },
    dropHover,
    registerResolver: (id, fn) => {
      if (fn) resolvers.current[id] = fn;
      else delete resolvers.current[id];
    },
    itemDragStart,
    openSend: (entry, kind) =>
      setSearch({
        open: true,
        mode: "send",
        target: { entry, owner: apiOwner(kind, entry) },
        token: Date.now(),
      }),
    reveal,
  };

  const width = dragWidth ?? ui.explorerWidth;
  const full = width === null;
  const newMark = drag?.target?.kind === "new" ? drag.target.index : null;

  return (
    <FilesProvider value={ctxValue}>
      <div ref={rootRef} className={`fx-root${dragWidth !== null || dragWeights ? " resizing" : ""}`}>
        <div className="fx-topbar">
          <SearchBar
            open={search.open}
            mode={search.mode}
            target={search.target}
            focusToken={search.token}
            onOpen={() => setSearch((s) => (s.open ? s : { ...s, open: true, token: s.token + 1 }))}
            onClose={closeSearch}
            onOpenResult={openResult}
            onReveal={revealEntry}
            notify={notify}
          />
        </div>

        <div className="fx-main">
          <div className={`fx-explorer ${full ? "full" : "sized"}`} style={full ? undefined : { width }}>
            <Explorer paneId={null} ui={ui} update={update} />
            <div
              className="fx-splitter"
              onPointerDown={startResize}
              onDoubleClick={() => update((s) => ({ ...s, explorerWidth: null }))}
              title="Потяните, чтобы освободить место справа"
            />
          </div>

          {!full && (
            <div
              className={`fx-workspace${ui.panes.length === 0 && newMark !== null ? " drop-new" : ""}`}
              data-fx-zone="w"
              onContextMenu={workspaceMenu}
            >
              {ui.panes.length === 0 ? (
                <div className="fx-workspace-hint">
                  Пустое место. Откройте .txt двойным кликом или перетащите сюда раздел за заголовок.
                </div>
              ) : (
                ui.panes.map((p, i) => {
                  const w = dragWeights?.[p.id] ?? p.weight;
                  const mark =
                    newMark === null
                      ? ""
                      : newMark === i
                        ? " drop-before"
                        : newMark === ui.panes.length && i === ui.panes.length - 1
                          ? " drop-after"
                          : "";
                  return (
                    <Fragment key={p.id}>
                      {i > 0 && <div className="fx-pane-splitter" onPointerDown={(e) => startPaneResize(e, i - 1)} />}
                      <div
                        ref={(el) => {
                          paneEls.current[p.id] = el;
                        }}
                        className={`fx-pane${p.kind === "editor" && activeEditor === p.id ? " active" : ""}${mark}`}
                        style={{ flex: `${w} 1 0px` }}
                      >
                        {p.kind === "explorer" ? (
                          <Explorer paneId={p.id} ui={ui} update={update} />
                        ) : (
                          <EditorPane
                            paneId={p.id}
                            state={editors[p.id] ?? { docs: [], active: null }}
                            focused={activeEditor === p.id}
                            onFocus={() => setActiveEditor(p.id)}
                            onActivate={(key) => dispatch({ t: "activate", pane: p.id, key })}
                            onCloseTab={(key) => void closeTab(p.id, key)}
                            onPatch={(key, patch) => dispatch({ t: "patch", pane: p.id, key, patch })}
                            registerSaver={(id, fn) => {
                              if (fn) savers.current.set(id, fn);
                              else savers.current.delete(id);
                            }}
                          />
                        )}
                      </div>
                    </Fragment>
                  );
                })
              )}
            </div>
          )}
        </div>

        <TransferPanel
          items={transfers}
          onCancel={(id) => void filesApi.cancelTransfer(id).catch(() => undefined)}
        />

        {ghost && (
          <div className="fx-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
            {ghost.title}
          </div>
        )}

        {notice && (
          <div className={`fx-toast ${notice.kind}`} role="alert">
            <span>{notice.text}</span>
            <button type="button" className="fx-icon-btn" onClick={() => setNotice(null)} aria-label="Закрыть">
              ×
            </button>
          </div>
        )}

        {menu && <FilesMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

        {conflict && (
          <ConflictDialog
            name={conflict.name}
            onChoose={(p) => {
              conflict.resolve(p);
              setConflict(null);
            }}
          />
        )}

        {choice && <ChoiceDialog req={choice} onChoose={answerChoice} />}

        {perm && (
          <PermissionsDialog
            owner={perm.owner}
            path={perm.path}
            name={perm.name}
            isDir={perm.isDir}
            onClose={() => setPerm(null)}
            onSaved={() => notify("Права сохранены", "info")}
          />
        )}
      </div>
    </FilesProvider>
  );
}