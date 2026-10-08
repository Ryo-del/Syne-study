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
}

/** Состояние интерфейса Files. Хранится на сервере (ui_put / ui_get), на ПК ничего не пишется. */
export interface FilesUiState {
  v: 1;
  sections: SectionUi[];
  /** null — explorer занимает всё окно. */
  explorerWidth: number | null;
}

export const DEFAULT_UI: FilesUiState = {
  v: 1,
  sections: [
    { id: "mine", hidden: false, collapsed: false },
    { id: "favorites", hidden: false, collapsed: false },
    { id: "server", hidden: false, collapsed: false },
  ],
  explorerWidth: null,
};

function isSectionId(v: unknown): v is SectionId {
  return v === "mine" || v === "favorites" || v === "server";
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
      sections.push({ id: s.id, hidden: s.hidden === true, collapsed: s.collapsed === true });
    }
  }
  for (const d of DEFAULT_UI.sections) {
    if (!seen.has(d.id)) sections.push({ ...d });
  }

  const w =
    typeof r.explorerWidth === "number" && Number.isFinite(r.explorerWidth)
      ? Math.max(MIN_EXPLORER_WIDTH, Math.round(r.explorerWidth))
      : null;

  return { v: 1, sections, explorerWidth: w };
}