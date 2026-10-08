import { Fragment, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { sameUser, type Me } from "../../files/perm";
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
import { entryKey } from "../../files/useSectionTree";
import { ChoiceDialog } from "./ChoiceDialog";
import { ConflictDialog } from "./ConflictDialog";
import { EditorPane } from "./EditorPane";
import { Explorer } from "./Explorer";
import {
  FilesProvider,
  type ChoiceRequest,
  type ClipItem,
  type DragState,
  type FilesCtxValue,
} from "./FilesContext";
import { FilesMenu, type MenuItem } from "./FilesMenu";
import { PermissionsDialog } from "./PermissionsDialog";
import "./files.css";

const MIN_PANE_WIDTH = 150;

/** Один и тот же файл из «Моей папки» и «Избранного» должен иметь один ключ вкладки. */
function docOwner(entry: FileEntry, kind: SectionId, me: Me) {
  return kind === "mine" || sameUser(entry.owner, me.login) ? "" : entry.owner;
}

export function Files() {
  const { ui, update, ready } = useFilesUi();
  const me = useMe();
  const { state: editors, dispatch } = useEditors();

  const rootRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const paneEls = useRef<Record<string, HTMLElement | null>>({});
  const savers = useRef(new Map<string, (key: string) => Promise<boolean>>());
  const justDragged = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const choiceResolve = useRef<((id: string | null) => void) | null>(null);

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

  // Перетаскивание заголовка раздела на pointer-событиях: нативный HTML5 DnD в Windows
  // ломается из-за нативного drop в Tauri.
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
  };

  const width = dragWidth ?? ui.explorerWidth;
  const full = width === null;
  const newMark = drag?.target?.kind === "new" ? drag.target.index : null;

  return (
    <FilesProvider value={ctxValue}>
      <div ref={rootRef} className={`fx-root${dragWidth !== null || dragWeights ? " resizing" : ""}`}>
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