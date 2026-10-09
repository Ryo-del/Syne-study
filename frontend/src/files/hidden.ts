const JUNK = new Set([
  ".ds_store",
  ".appledouble",
  "__macosx",
  "thumbs.db",
  "desktop.ini",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
  ".temporaryitems",
  ".documentrevisions-v100",
]);

/** Служебные имена macOS/Windows. Совпадает со списком в Go (IsJunkName). */
export function isJunkName(name: string): boolean {
  const n = name.toLowerCase();
  return JUNK.has(n) || n.startsWith("._");
}

export function baseName(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return i >= 0 ? t.slice(i + 1) : t;
}