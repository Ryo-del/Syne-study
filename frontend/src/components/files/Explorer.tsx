import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { SECTION_TITLES, type FilesUiState, type SectionId } from "../../files/uiState";
import { FilesMenu, type MenuItem } from "./FilesMenu";
import { NO_SELECTION, Section, type Selection } from "./Section";

interface Props {
  ui: FilesUiState;
  update: (fn: (s: FilesUiState) => FilesUiState) => void;
}

export function Explorer({ ui, update }: Props) {
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [drag, setDrag] = useState<{ id: SectionId; index: number } | null>(null);
  const els = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const justDragged = useRef(false);
  const noticeTimer = useRef<number | null>(null);

  const visible = ui.sections.filter((s) => !s.hidden);

  function notify(msg: string) {
    setNotice(msg);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 5000);
  }

  function moveSection(id: SectionId, visibleIndex: number) {
    update((s) => {
      const vis = s.sections.filter((x) => !x.hidden);
      const moving = s.sections.find((x) => x.id === id);
      if (!moving) return s;
      const target = vis[visibleIndex];
      if (target?.id === id) return s;
      const rest = s.sections.filter((x) => x.id !== id);
      let at: number;
      if (target) {
        at = rest.findIndex((x) => x.id === target.id);
      } else {
        const lastVisible = [...rest].reverse().find((x) => !x.hidden);
        if (!lastVisible) return s;
        at = rest.findIndex((x) => x.id === lastVisible.id) + 1;
      }
      rest.splice(at, 0, moving);
      return { ...s, sections: rest };
    });
  }

  // Перетаскивание заголовка на pointer-событиях: нативный HTML5 DnD в Windows
  // ломается из-за нативного drop в Tauri.
  function onHeaderPointerDown(e: ReactPointerEvent, id: SectionId) {
    if (e.button !== 0) return;
    const startY = e.clientY;
    let active = false;
    let index = -1;

    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientY - startY) < 5) return;
      active = true;
      let idx = visible.length;
      for (let i = 0; i < visible.length; i += 1) {
        const el = els.current[visible[i].id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          idx = i;
          break;
        }
      }
      index = idx;
      setDrag({ id, index: idx });
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
      if (index >= 0) moveSection(id, index);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function toggleCollapsed(id: SectionId) {
    if (justDragged.current) return;
    update((s) => ({
      ...s,
      sections: s.sections.map((x) => (x.id === id ? { ...x, collapsed: !x.collapsed } : x)),
    }));
  }

  function toggleHidden(id: SectionId) {
    update((s) => ({
      ...s,
      sections: s.sections.map((x) => (x.id === id ? { ...x, hidden: !x.hidden } : x)),
    }));
    if (selection.section === id) setSelection(NO_SELECTION);
  }

  function openMenu(e: ReactMouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  const menuItems: MenuItem[] = ui.sections.map((s) => ({
    label: SECTION_TITLES[s.id],
    checked: !s.hidden,
    onClick: () => toggleHidden(s.id),
  }));

  return (
    <div className="fx-explorer-inner">
      <div className="fx-head" onContextMenu={openMenu}>
        <span className="fx-head-title">Files</span>
        <div className="fx-head-actions">
          <button
            type="button"
            className="fx-icon-btn"
            title="Обновить"
            onClick={() => setRefreshSignal((n) => n + 1)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8a5 5 0 1 1-1.6-3.7" />
              <path d="M13 2.5V5h-2.5" />
            </svg>
          </button>
          <button
            type="button"
            className="fx-icon-btn"
            title="Разделы"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <circle cx="3" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="13" cy="8" r="1.3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="fx-sections">
        {visible.map((s, i) => (
          <Section
            key={s.id}
            id={s.id}
            collapsed={s.collapsed}
            dragging={drag?.id === s.id}
            dropMark={
              drag?.index === i ? "before" : drag && drag.index === visible.length && i === visible.length - 1 ? "after" : null
            }
            selection={selection}
            onSelection={setSelection}
            notify={notify}
            refreshSignal={refreshSignal}
            registerEl={(id, el) => {
              els.current[id] = el;
            }}
            onHeaderPointerDown={onHeaderPointerDown}
            onHeaderContextMenu={openMenu}
            onToggleCollapsed={() => toggleCollapsed(s.id)}
          />
        ))}
        {visible.length === 0 && (
          <div className="fx-hint" onContextMenu={openMenu}>
            Все разделы скрыты. Нажмите «⋯» вверху, чтобы вернуть.
          </div>
        )}
      </div>

      {notice && (
        <div className="fx-notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="fx-icon-btn" onClick={() => setNotice("")} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}

      {menu && <FilesMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}