export type SectionId = "mine" | "favorites" | "server";

export const SECTION_TITLES: Record<SectionId, string> = {
  mine: "Моя папка",
  favorites: "Избранное",
  server: "Сервер",
};

export const MIN_EXPLORER_WIDTH = 260;

export interface SectionUi {
  id: SectionId;
  hidden: boolean;
  collapsed: boolean;
  /** null — общий explorer, иначе id вынесенного окна. */
  pane: string | null;
}

export interface PaneUi {
  id: string;
  kind: "editor" | "explorer";
  /** Доля ширины (flex-grow); после ручного ресайза хранится в пикселях. */
  weight: number;
}

/** Состояние интерфейса Files. Хранится на сервере (ui_put / ui_get), на ПК ничего не пишется. */
export interface FilesUiState {
  v: 1;
  sections: SectionUi[];
  panes: PaneUi[];
  /** null — explorer занимает всё окно. */
  explorerWidth: number | null;
}

export const DEFAULT_UI: FilesUiState = {
  v: 1,
  sections: [
    { id: "mine", hidden: false, collapsed: false, pane: null },
    { id: "favorites", hidden: false, collapsed: false, pane: null },
    { id: "server", hidden: false, collapsed: false, pane: null },
  ],
  panes: [],
  explorerWidth: null,
};

export type DropTarget =
  | { kind: "explorer"; pane: string | null; index: number }
  | { kind: "new"; index: number };

function isSectionId(v: unknown): v is SectionId {
  return v === "mine" || v === "favorites" || v === "server";
}

export function newPaneWeight(panes: PaneUi[]): number {
  if (panes.length === 0) return 1;
  const avg = panes.reduce((a, p) => a + p.weight, 0) / panes.length;
  return Math.round(avg * 100) / 100 || 1;
}

/** Приводит раскладку к согласованному виду: прячет «висящие» ссылки, убирает пустые окна. */
export function cleanupLayout(s: FilesUiState): FilesUiState {
  let sections = s.sections.map((x) => (x.hidden && x.pane ? { ...x, pane: null } : x));
  const explorerIds = new Set(s.panes.filter((p) => p.kind === "explorer").map((p) => p.id));
  sections = sections.map((x) => (x.pane && !explorerIds.has(x.pane) ? { ...x, pane: null } : x));
  const used = new Set(sections.filter((x) => x.pane).map((x) => x.pane as string));
  const panes = s.panes.filter((p) => p.kind === "editor" || used.has(p.id));
  return { ...s, sections, panes };
}

export function normalizeUi(raw: unknown): FilesUiState {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_UI;
  }
  const r = raw as Record<string, unknown>;

  const seen = new Set<SectionId>();
  const sections: SectionUi[] = [];
  if (Array.isArray(r.sections)) {
    for (const item of r.sections) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      if (!isSectionId(s.id) || seen.has(s.id)) continue;
      seen.add(s.id);
      sections.push({
        id: s.id,
        hidden: s.hidden === true,
        collapsed: s.collapsed === true,
        pane: typeof s.pane === "string" && s.pane ? s.pane : null,
      });
    }
  }
  for (const d of DEFAULT_UI.sections) {
    if (!seen.has(d.id)) sections.push({ ...d });
  }

  // Окна-редакторы не восстанавливаются: открытые вкладки между запусками не хранятся.
  const paneIds = new Set<string>();
  const panes: PaneUi[] = [];
  if (Array.isArray(r.panes)) {
    for (const item of r.panes) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      if (typeof p.id !== "string" || !p.id || paneIds.has(p.id) || p.kind !== "explorer") continue;
      paneIds.add(p.id);
      const weight = typeof p.weight === "number" && Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 1;
      panes.push({ id: p.id, kind: "explorer", weight });
    }
  }

  const w =
    typeof r.explorerWidth === "number" && Number.isFinite(r.explorerWidth)
      ? Math.max(MIN_EXPLORER_WIDTH, Math.round(r.explorerWidth))
      : null;

  return cleanupLayout({ v: 1, sections, panes, explorerWidth: w });
}

/** Перенос раздела: в позицию внутри explorer (общего или вынесенного) или в новое окно. */
export function applyDrop(s: FilesUiState, id: SectionId, t: DropTarget): FilesUiState {
  const moving = s.sections.find((x) => x.id === id);
  if (!moving) return s;
  const rest = s.sections.filter((x) => x.id !== id);

  if (t.kind === "new") {
    const paneId = crypto.randomUUID();
    const panes = [...s.panes];
    panes.splice(Math.min(t.index, panes.length), 0, {
      id: paneId,
      kind: "explorer",
      weight: newPaneWeight(s.panes),
    });
    return { ...s, panes, sections: [...rest, { ...moving, pane: paneId, hidden: false }] };
  }

  const vis = s.sections.filter((x) => !x.hidden && (x.pane ?? null) === t.pane);
  const target = vis[t.index];
  if (target?.id === id) return s; // тот же раздел на том же месте

  const moved: SectionUi = { ...moving, pane: t.pane, hidden: false };
  let at: number;
  if (target) {
    at = rest.findIndex((x) => x.id === target.id);
  } else {
    const last = [...rest].reverse().find((x) => !x.hidden && (x.pane ?? null) === t.pane);
    at = last ? rest.findIndex((x) => x.id === last.id) + 1 : rest.length;
  }
  rest.splice(at, 0, moved);
  return { ...s, sections: rest };
}