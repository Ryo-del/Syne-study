import type { FileAction, FileCap, FileEntry } from "./types";
import type { SectionId } from "./uiState";

export interface Me {
  login: string;
  teacher: boolean;
}

export function sameUser(a: string, b: string) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Доступность пункта в интерфейсе. Настоящую проверку делает сервер.
 * Свои файлы и всё у преподавателя: разрешено, пока сервер явно не сказал «нет».
 * Чужие файлы: разрешено, только если сервер явно сказал «да».
 */
export function canDo(me: Me, kind: SectionId, e: FileEntry, cap: FileAction | FileCap): boolean {
  const v = e.can?.[cap];
  const own = kind === "mine" || sameUser(e.owner, me.login);
  return own || me.teacher ? v !== false : v === true;
}