import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filesApi } from "./api";
import { describeFileError } from "./errors";
import type { FileEntry } from "./types";
import type { SectionId } from "./uiState";
import { isJunkName } from "./hidden";

export interface Row {
  entry: FileEntry;
  key: string;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export function entryKey(e: FileEntry) {
  return `${e.owner}\u0000${e.path}`;
}

/** Для своей папки сервер ждёт пустого owner (Ref.owner: «пусто — своя папка»). */
export function apiOwner(kind: SectionId, e: FileEntry) {
  return kind === "mine" ? "" : e.owner;
}

function sortEntries(list: FileEntry[]): FileEntry[] {
  return list
    .filter((e) => !isJunkName(e.name))
    .sort((a, b) =>
    a.is_dir === b.is_dir
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      : a.is_dir
        ? -1
        : 1,
  );
}

export function useSectionTree(kind: SectionId) {
  const data = useRef({
    roots: [] as FileEntry[],
    kids: new Map<string, FileEntry[]>(),
    expanded: new Set<string>(),
    loading: new Set<string>(),
    known: new Map<string, FileEntry>(),
  });
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const gen = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const bump = useCallback(() => {
    if (alive.current) setVersion((v) => v + 1);
  }, []);

  const listFolder = useCallback(
    async (entry: FileEntry) => {
      const r = await filesApi.list(apiOwner(kind, entry), entry.path);
      return sortEntries(r.entries);
    },
    [kind],
  );

  const reload = useCallback(async () => {
    const g = ++gen.current;
    const d = data.current;
    try {
      let fetched: FileEntry[];
      if (kind === "mine") fetched = (await filesApi.list("", "")).entries;
      else if (kind === "favorites") fetched = await filesApi.favList();
      else fetched = await filesApi.listOwners();

      const roots = sortEntries(fetched);
      if (g !== gen.current) return;
      roots.forEach((e) => d.known.set(entryKey(e), e));

      const open = Array.from(d.expanded);
      const results = await Promise.all(
        open.map(async (key) => {
          const e = d.known.get(key);
          if (!e) return { key, list: null as FileEntry[] | null };
          try {
            return { key, list: await listFolder(e) };
          } catch {
            return { key, list: null as FileEntry[] | null };
          }
        }),
      );
      if (g !== gen.current) return;

      d.roots = roots;
      for (const { key, list } of results) {
        if (list) {
          d.kids.set(key, list);
          list.forEach((e) => d.known.set(entryKey(e), e));
        } else {
          d.expanded.delete(key);
          d.kids.delete(key);
        }
      }
      if (!alive.current) return;
      setError("");
      setStatus("ready");
      setGeneration((n) => n + 1);
      bump();
    } catch (err) {
      if (g !== gen.current || !alive.current) return;
      setError(describeFileError(err));
      setStatus("error");
    }
  }, [kind, listFolder, bump]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Возвращает текст ошибки или null. */
  const toggle = useCallback(
    async (entry: FileEntry): Promise<string | null> => {
      if (!entry.is_dir) return null;
      const d = data.current;
      const key = entryKey(entry);
      if (d.expanded.has(key)) {
        d.expanded.delete(key);
        bump();
        return null;
      }
      d.expanded.add(key);
      d.known.set(key, entry);
      d.loading.add(key);
      bump();
      try {
        const list = await listFolder(entry);
        if (d.expanded.has(key)) {
          d.kids.set(key, list);
          list.forEach((e) => d.known.set(entryKey(e), e));
        }
        return null;
      } catch (err) {
        d.expanded.delete(key);
        return describeFileError(err);
      } finally {
        d.loading.delete(key);
        bump();
      }
    },
    [bump, listFolder],
  );
    /** Раскрывает цепочку папок до файла. Возвращает ключ строки или текст ошибки. */
  const reveal = useCallback(
    async (target: FileEntry): Promise<{ key: string | null; error: string | null }> => {
      const d = data.current;
      const parts = target.path.split("/").filter(Boolean);
      const chain: string[] = kind === "server" ? [""] : []; // в «Сервере» сначала папка владельца
      for (let i = 1; i < parts.length; i += 1) chain.push(parts.slice(0, i).join("/"));

      // В «Моей папке» владелец один; сравниваем по пути, чтобы не зависеть от формы owner.
      const findKnown = (p: string): FileEntry | undefined => {
        if (kind !== "mine") return d.known.get(`${target.owner}\u0000${p}`);
        for (const v of d.known.values()) if (v.path === p) return v;
        return undefined;
      };

      for (const p of chain) {
        const e = findKnown(p);
        if (!e) return { key: null, error: null };
        if (!d.expanded.has(entryKey(e))) {
          const msg = await toggle(e);
          if (msg) return { key: null, error: msg };
        }
      }
      const self = findKnown(target.path);
      return { key: self ? entryKey(self) : null, error: null };
    },
    [kind, toggle],
  );
  const rows = useMemo(() => {
    const d = data.current;
    const out: Row[] = [];
    const walk = (list: FileEntry[], depth: number) => {
      for (const entry of list) {
        const key = entryKey(entry);
        const expanded = entry.is_dir && d.expanded.has(key);
        out.push({ entry, key, depth, expanded, loading: d.loading.has(key) });
        if (expanded) walk(d.kids.get(key) ?? [], depth + 1);
      }
    };
    walk(d.roots, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return { rows, status, error, generation, toggle, reload, reveal };
}
