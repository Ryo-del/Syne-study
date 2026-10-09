import { ApiError } from "../lib/api";
import { filesApi } from "./api";
import { describeFileError } from "./errors";
import type { ConflictPolicy, FileEntry } from "./types";

export interface PasteItem {
  owner: string; // как ждёт API ("" — своя папка)
  path: string;
  name: string;
  is_dir: boolean;
}

export interface PasteResult {
  last?: FileEntry;
  skipped: number;
}

export async function pasteAll(
  items: PasteItem[],
  dest: { owner: string; path: string },
  askConflict: (name: string) => Promise<ConflictPolicy | null>,
  notify: (msg: string) => void,
): Promise<PasteResult> {
  const loop = items.find(
    (i) => i.is_dir && i.owner === dest.owner && (dest.path === i.path || dest.path.startsWith(`${i.path}/`)),
  );
  if (loop) {
    notify("Нельзя вставить папку в саму себя");
    return { skipped: 0 };
  }

  let policy: ConflictPolicy | undefined;
  let last: FileEntry | undefined;
  let skipped = 0;

  for (const it of items) {
    const attempt = () =>
      filesApi.paste({ owner: it.owner, path: it.path }, { owner: dest.owner, path: dest.path }, policy);
    try {
      let r: Awaited<ReturnType<typeof attempt>>;
      try {
        r = await attempt();
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "exists") || policy) throw err;
        const p = await askConflict(it.name);
        if (!p) break; // отмена
        policy = p;
        r = await attempt();
      }
      skipped += r.skipped;
      if (r.entry) last = r.entry;
    } catch (err) {
      notify(describeFileError(err));
      break;
    }
  }
  return { last, skipped };
}