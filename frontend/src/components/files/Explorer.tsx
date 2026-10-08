import type { MouseEvent as ReactMouseEvent } from "react";
import { SECTION_TITLES, cleanupLayout, type FilesUiState, type SectionId } from "../../files/uiState";
import { NO_SELECTION, type Selection } from "../../files/selection";
import { useFilesCtx } from "./FilesContext";
import type { MenuItem } from "./FilesMenu";
import { Section } from "./Section";

interface Props {
  /** null — общий explorer, иначе id вынесенного окна. */
  paneId: string | null;
  ui: FilesUiState;
  update: (fn: (s: FilesUiState) => FilesUiState) => void;
}

export function Explorer({ paneId, ui, update }: Props) {
  const ctx = useFilesCtx();
  const visible = ui.sections.filter((s) => !s.hidden && (s.pane ?? null) === paneId);
  const drag = ctx.dragState;

  function toggleCollapsed(id: SectionId) {
    if (ctx.wasDragging()) return;
    update((s) => ({
      ...s,
      sections: s.sections.map((x) => (x.id === id ? { ...x, collapsed: !x.collapsed } : x)),
    }));
  }

  function toggleHidden(id: SectionId) {
    update((s) =>
      cleanupLayout({
        ...s,
        sections: s.sections.map((x) => (x.id === id ? { ...x, hidden: !x.hidden, pane: null } : x)),
      }),
    );
    if (ctx.selection.section === id) ctx.setSelection(NO_SELECTION);
  }

  function returnToMain(id: SectionId) {
    update((s) =>
      cleanupLayout({ ...s, sections: s.sections.map((x) => (x.id === id ? { ...x, pane: null } : x)) }),
    );
  }

  function sectionsMenuItems(): MenuItem[] {
    return ui.sections.map((s) => ({
      label: SECTION_TITLES[s.id],
      checked: !s.hidden,
      onClick: () => toggleHidden(s.id),
    }));
  }

  function openSectionsMenu(e: ReactMouseEvent) {
    e.preventDefault();
    ctx.openMenu(e.clientX, e.clientY, sectionsMenuItems());
  }

  function headerMenu(e: ReactMouseEvent, id: SectionId) {
    if (paneId === null) {
      openSectionsMenu(e);
      return;
    }
    e.preventDefault();
    ctx.openMenu(e.clientX, e.clientY, [
      { label: "Вернуть в общий explorer", onClick: () => returnToMain(id) },
      { label: "Скрыть раздел", onClick: () => toggleHidden(id) },
    ]);
  }

  const t = drag?.target;
  const dropIntoEmpty = !!t && t.kind === "explorer" && t.pane === paneId && visible.length === 0;

  return (
    <div className="fx-explorer-inner" data-fx-zone={paneId ? `e:${paneId}` : "e:main"}>
      <div className="fx-head" onContextMenu={paneId === null ? openSectionsMenu : undefined}>
        <span className="fx-head-title">Files</span>
        <div className="fx-head-actions">
          <button type="button" className="fx-icon-btn" title="Обновить" onClick={ctx.refreshAll}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8a5 5 0 1 1-1.6-3.7" />
              <path d="M13 2.5V5h-2.5" />
            </svg>
          </button>
          {paneId === null ? (
            <button
              type="button"
              className="fx-icon-btn"
              title="Разделы"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                ctx.openMenu(r.left, r.bottom + 4, sectionsMenuItems());
              }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <circle cx="3" cy="8" r="1.3" />
                <circle cx="8" cy="8" r="1.3" />
                <circle cx="13" cy="8" r="1.3" />
              </svg>
            </button>
          ) : (
            <button type="button" className="fx-icon-btn" title="Закрыть окно" onClick={() => ctx.closePane(paneId)}>
              ×
            </button>
          )}
        </div>
      </div>

      <div className={`fx-sections${dropIntoEmpty ? " drop-all" : ""}`}>
        {visible.map((s, i) => {
          const mark =
            t && t.kind === "explorer" && t.pane === paneId
              ? t.index === i
                ? "before"
                : t.index === visible.length && i === visible.length - 1
                  ? "after"
                  : null
              : null;
          return (
            <Section
              key={s.id}
              id={s.id}
              paneId={paneId}
              collapsed={s.collapsed}
              dragging={drag?.id === s.id}
              dropMark={mark}
              selection={ctx.selection}
              onSelection={ctx.setSelection}
              notify={ctx.notify}
              refreshSignal={ctx.refreshSignal}
              registerEl={ctx.registerSectionEl}
              onHeaderPointerDown={(e, id) => ctx.dragStart(e, id)}
              onHeaderContextMenu={(e) => headerMenu(e, s.id)}
              onToggleCollapsed={() => toggleCollapsed(s.id)}
            />
          );
        })}
        {visible.length === 0 && paneId === null && (
          <div className="fx-hint" onContextMenu={openSectionsMenu}>
            Разделы скрыты или вынесены в отдельные окна. Нажмите «⋯» вверху, чтобы вернуть.
          </div>
        )}
      </div>
    </div>
  );
}