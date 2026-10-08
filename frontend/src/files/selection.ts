import type { SectionId } from "./uiState";

export interface Selection {
  section: SectionId | null;
  keys: string[];
  anchor: string | null;
}

export const NO_SELECTION: Selection = { section: null, keys: [], anchor: null };