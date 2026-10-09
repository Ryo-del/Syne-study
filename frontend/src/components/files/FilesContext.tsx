import { createContext, useContext } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Me } from "../../files/perm";
import type { Selection } from "../../files/selection";
import type { ConflictPolicy, FileEntry } from "../../files/types";
import type { DropTarget, SectionId } from "../../files/uiState";
import type { MenuItem } from "./FilesMenu";

/** Элемент внутреннего буфера копирования. Буфер живёт только в памяти окна. */
export interface ClipItem {
  owner: string; // уже в виде, который ждёт API ("" — своя папка)
  path: string;
  name: string;
  is_dir: boolean;
}

export interface ChoiceButton {
  id: string;
  label: string;
  kind?: "primary" | "danger";
}
export interface DropHover {
  section: SectionId;
  /** Ключ строки-папки или "root" (корень «Моей папки»). */
  key: string;
  entry: FileEntry;
  /** Как ждёт API. */
  owner: string;
  path: string;
  /** Есть ли право «вставлять». */
  ok: boolean;
}

export type DropResolver = (index: number) => DropHover | null;

export interface RevealRequest {
  section: SectionId;
  entry: FileEntry;
  nonce: number;
}
export interface ChoiceRequest {
  title: string;
  text: string;
  buttons: ChoiceButton[];
}

export interface DragState {
  id: SectionId;
  target: DropTarget | null;
}

export interface FilesCtxValue {
  me: Me;
  notify: (msg: string, kind?: "info" | "error") => void;

  clipboard: ClipItem[];
  setClipboard: (items: ClipItem[]) => void;
  favKeys: Set<string>;
  favVersion: number;
  refreshFavs: () => void;

  selection: Selection;
  setSelection: (s: Selection) => void;
  refreshSignal: number;
  refreshAll: () => void;

  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  askConflict: (name: string) => Promise<ConflictPolicy | null>;
  askChoice: (req: ChoiceRequest) => Promise<string | null>;
  openPermissions: (entry: FileEntry, kind: SectionId) => void;

  openFile: (entry: FileEntry, kind: SectionId, editable: boolean) => void;
  newWindow: () => void;
  closePane: (paneId: string) => void;

  dragStart: (e: ReactPointerEvent, id: SectionId) => void;
  wasDragging: () => boolean;
  dragState: DragState | null;
  dropHover: DropHover | null;
  registerResolver: (id: SectionId, fn: DropResolver | null) => void;
  itemDragStart: (e: ReactPointerEvent, kind: SectionId, entries: FileEntry[]) => void;
  openSend: (entry: FileEntry, kind: SectionId) => void;
  reveal: RevealRequest | null;
  registerSectionEl: (id: SectionId, el: HTMLElement | null) => void;
}

const Ctx = createContext<FilesCtxValue | null>(null);
export const FilesProvider = Ctx.Provider;

export function useFilesCtx(): FilesCtxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("FilesProvider is missing");
  return v;
}