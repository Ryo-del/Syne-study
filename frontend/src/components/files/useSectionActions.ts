import type { MouseEvent as ReactMouseEvent } from "react";
import { downloadAs, downloadToDownloads, openAs } from "../../files/actions";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { canDo, sameUser } from "../../files/perm";
import type { FileAction, FileCap, FileEntry } from "../../files/types";
import type { SectionId } from "../../files/uiState";
import { apiOwner, entryKey, type Row, type useSectionTree } from "../../files/useSectionTree";
import { ApiError } from "../../lib/api";
import { useFilesCtx } from "./FilesContext";
import type { MenuItem } from "./FilesMenu";

export interface ActionDeps {
  id: SectionId;
  paneId: string | null;
  tree: ReturnType<typeof useSectionTree>;
  selectedRows: Row[];
  selectedKeys: Set<string>;
  select: (keys: string[], anchor: string | null) => void;
  clear: () => void;
  setEditing: (key: string | null) => void;
  startRename: (row: Row) => void;
  notify: (msg: string, kind?: "info" | "error") => void;
  /** Синтетическая запись корня «Моей папки» (owner "" и path ""). */
  rootEntry: FileEntry;
}

function dropNested(list: FileEntry[]): FileEntry[] {
  return list.filter(
    (a) => !list.some((b) => b !== a && b.is_dir && b.owner === a.owner && a.path.startsWith(`${b.path}/`)),
  );
}

const isTxt = (e: FileEntry) => !e.is_dir && e.name.toLowerCase().endsWith(".txt");

export function useSectionActions(d: ActionDeps) {
  const ctx = useFilesCtx();
  const { id, tree, notify } = d;
  const can = (e: FileEntry, cap: FileAction | FileCap) => canDo(ctx.me, id, e, cap);

  /** После изменения: обновить папку-приёмник. Закрытую папку раскрываем. */
  async function refreshAfter(parent: FileEntry | null) {
    const row = parent ? tree.rows.find((r) => r.key === entryKey(parent)) : undefined;
    if (parent && row && !row.expanded) {
      const msg = await tree.toggle(parent);
      if (msg) notify(msg);
    } else {
      await tree.reload();
    }
  }

  async function createIn(parent: FileEntry | null, isDir: boolean) {
    const owner = parent ? apiOwner(id, parent) : "";
    const parentPath = parent?.path ?? "";
    const base = isDir ? "Новая папка" : "Новый файл.txt";
    let created: FileEntry | undefined;

    for (let n = 1; n <= 50; n += 1) {
      const name = n === 1 ? base : isDir ? `${base} ${n}` : base.replace(/\.txt$/, ` ${n}.txt`);
      try {
        created = isDir
          ? await filesApi.mkdir(owner, parentPath, name)
          : await filesApi.createFile(owner, parentPath, name);
        break;
      } catch (err) {
        if (err instanceof ApiError && err.code === "exists") continue;
        notify(describeFileError(err));
        return;
      }
    }
    if (!created) {
      notify("Не удалось подобрать свободное имя");
      return;
    }
    await refreshAfter(parent);
    const key = entryKey(created);
    d.select([key], key);
    d.setEditing(key); // сразу режим переименования, как в VS Code
  }

  function copy(entries: FileEntry[]) {
    ctx.setClipboard(
      entries.map((e) => ({ owner: apiOwner(id, e), path: e.path, name: e.name, is_dir: e.is_dir })),
    );
    notify(
      entries.length === 1 ? `Скопировано: ${entries[0].name}` : `Скопировано элементов: ${entries.length}`,
      "info",
    );
  }

  async function pasteInto(dest: FileEntry | null) {
    const items = ctx.clipboard;
    if (items.length === 0) return;
    const destOwner = dest ? apiOwner(id, dest) : "";
    const destPath = dest?.path ?? "";

    const loop = items.find(
      (i) => i.is_dir && i.owner === destOwner && (destPath === i.path || destPath.startsWith(`${i.path}/`)),
    );
    if (loop) {
      notify("Нельзя вставить папку в саму себя");
      return;
    }

    let policy: Parameters<typeof filesApi.paste>[2];
    let last: FileEntry | undefined;
    let skipped = 0;

    for (const it of items) {
      const attempt = () =>
        filesApi.paste({ owner: it.owner, path: it.path }, { owner: destOwner, path: destPath }, policy);
      try {
        let r: Awaited<ReturnType<typeof attempt>>;
        try {
          r = await attempt();
        } catch (err) {
          if (!(err instanceof ApiError && err.code === "exists") || policy) throw err;
          const p = await ctx.askConflict(it.name);
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

    await refreshAfter(dest);
    if (last) {
      const key = entryKey(last);
      d.select([key], key);
    }
    if (skipped > 0) notify(`Пропущено элементов: ${skipped}`, "info");
  }

  async function duplicate(entries: FileEntry[]) {
    const made: FileEntry[] = [];
    for (const e of entries) {
      try {
        const n = await filesApi.duplicate(apiOwner(id, e), e.path);
        if (n) made.push(n);
      } catch (err) {
        notify(describeFileError(err));
        break;
      }
    }
    await tree.reload();
    if (made.length > 0) {
      const keys = made.map(entryKey);
      d.select(keys, keys[0]);
    }
  }

  async function download(entries: FileEntry[], pick: boolean) {
    try {
      if (pick) {
        const r = await downloadAs(entries[0]);
        if (r) notify(`Скачано: ${r.path}`, "info");
        return;
      }
      notify("Скачивание…", "info");
      let last: Awaited<ReturnType<typeof downloadToDownloads>> | undefined;
      for (const e of entries) last = await downloadToDownloads(e);
      notify(
        entries.length === 1 && last ? `Скачано: ${last.path}` : `Скачано в «Загрузки»: ${entries.length}`,
        "info",
      );
    } catch (err) {
      notify(describeFileError(err));
    }
  }

  async function openAsProgram(e: FileEntry) {
    try {
      await openAs(e);
    } catch (err) {
      notify(describeFileError(err));
    }
  }

  async function copyPath(entries: FileEntry[]) {
    const text = entries
      .map((e) => `${e.owner_name || e.owner}/${e.path}`.replace(/\/$/, ""))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      notify("Путь скопирован", "info");
    } catch {
      notify("Не удалось скопировать путь");
    }
  }

  async function setFavorite(entries: FileEntry[], add: boolean) {
    const res = await Promise.allSettled(
      entries.map((e) =>
        add ? filesApi.favAdd(apiOwner(id, e), e.path) : filesApi.favRemove(apiOwner(id, e), e.path),
      ),
    );
    const failed = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) notify(describeFileError(failed.reason));
    ctx.refreshFavs();
  }

  /** Настоящее удаление (меню «Удалить» и Delete в «Моей папке» и «Сервере»). */
  async function removeReal(targets: Row[]) {
    const cand = targets
      .filter((r) => !(id === "server" && r.depth === 0) && can(r.entry, "delete"))
      .map((r) => r.entry);
    if (cand.length === 0) {
      notify("Нет права на удаление");
      return;
    }
    const res = await Promise.allSettled(
      dropNested(cand).map((e) => filesApi.remove(apiOwner(id, e), e.path)),
    );
    const failed = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) notify(describeFileError(failed.reason));
    else if (cand.length < targets.length) notify("Часть элементов не удалена: нет права");
    d.clear();
    void tree.reload();
  }

  function rowMenu(e: ReactMouseEvent, row: Row) {
    e.preventDefault();
    e.stopPropagation();

    let targets: Row[];
    if (d.selectedKeys.has(row.key)) {
      targets = d.selectedRows;
    } else {
      d.select([row.key], row.key);
      targets = [row];
    }
    const entries = targets.map((r) => r.entry);
    const single = entries.length === 1;
    const t = entries[0];
    const singleDir = single && t.is_dir;
    const every = (cap: FileAction | FileCap) => entries.every((x) => can(x, cap));
    const ownerRoot = targets.some((r) => id === "server" && r.depth === 0);
    const hasClip = ctx.clipboard.length > 0;
    const allFav = entries.every((x) => ctx.favKeys.has(entryKey(x)));
    // «Настроить права»: владельцу и преподавателю; чужим пункт не показываем.
    const mayConfigure =
      ctx.me.teacher || entries.every((x) => id === "mine" || sameUser(x.owner, ctx.me.login));

    const items: MenuItem[] = [];

    if (singleDir) {
      items.push(
        { label: "Создать файл", disabled: !can(t, "paste"), onClick: () => void createIn(t, false) },
        { label: "Создать папку", disabled: !can(t, "paste"), onClick: () => void createIn(t, true) },
        { label: "Вставить", disabled: !hasClip || !can(t, "paste"), onClick: () => void pasteInto(t) },
        { separator: true },
      );
    } else {
      items.push(
        {
          label: "Открыть",
          disabled: !(single && isTxt(t) && can(t, "open")),
            onClick: () => ctx.openFile(t, id, can(t, "edit")),
        },
        {
          label: "Открыть как…",
          disabled: !(single && !t.is_dir && can(t, "download")),
          onClick: () => void openAsProgram(t),
        },
        { separator: true },
      );
    }

    items.push(
      {
        label: singleDir ? "Скачать папку" : "Скачать",
        disabled: !every("download"),
        onClick: () => void download(entries, false),
      },
      {
        label: singleDir ? "Скачать папку как (zip)…" : "Скачать как…",
        disabled: !single || !every("download"),
        onClick: () => void download(entries, true),
      },
      { separator: true },
    );

    if (!singleDir) {
      items.push(
        {
          label: "Отправить",
          disabled: !(single && !t.is_dir && can(t, "send")),
          onClick: () => notify("Отправка в чат появится на этапе 7", "info"),
        },
        { separator: true },
      );
    }

    if (mayConfigure) {
      items.push(
        {
          label: "Настроить права…",
          disabled: !single,
          onClick: () => ctx.openPermissions(t, id),
        },
        { separator: true },
      );
    }

    items.push(
      { label: "Скопировать", disabled: !every("copy"), onClick: () => copy(entries) },
      { label: "Скопировать путь", onClick: () => void copyPath(entries) },
      { separator: true },
      { label: "Дублировать", disabled: !every("duplicate"), onClick: () => void duplicate(entries) },
      { separator: true },
      {
        label: "Переименовать",
        disabled: !single || ownerRoot || !can(t, "rename"),
        onClick: () => d.startRename(targets[0]),
      },
      {
        label: "Удалить",
        disabled: ownerRoot || !every("delete"),
        onClick: () => void removeReal(targets),
      },
      { separator: true },
      {
        label: allFav ? "Убрать из избранного" : "Добавить в избранное",
        onClick: () => void setFavorite(entries, !allFav),
      },
    );

    ctx.openMenu(e.clientX, e.clientY, items);
  }

  /** Меню пустого места. Цель есть только в «Моей папке» (её корень). */
  function bodyMenu(e: ReactMouseEvent) {
    e.preventDefault();
    d.clear();
    const root = id === "mine" ? d.rootEntry : null;
    const ok = (cap: FileAction | FileCap) => !!root && can(root, cap);
    const items: MenuItem[] = [
      { label: "Новое окно", onClick: () => ctx.newWindow() },
      {
        label: "Закрыть окно",
        disabled: d.paneId === null,
        onClick: () => {
          if (d.paneId) ctx.closePane(d.paneId);
        },
      },
      { separator: true },
      { label: "Создать файл", disabled: !ok("paste"), onClick: () => void createIn(null, false) },
      { label: "Создать папку", disabled: !ok("paste"), onClick: () => void createIn(null, true) },
      {
        label: "Вставить",
        disabled: !ok("paste") || ctx.clipboard.length === 0,
        onClick: () => void pasteInto(null),
      },
      { separator: true },
      { label: "Скачать папку", disabled: !ok("download"), onClick: () => void download([d.rootEntry], false) },
      {
        label: "Скачать папку как (zip)…",
        disabled: !ok("download"),
        onClick: () => void download([d.rootEntry], true),
      },
      { separator: true },
      {
        label: "Настроить права…",
        disabled: !root,
        onClick: () => ctx.openPermissions(d.rootEntry, id),
      },
    ];
    ctx.openMenu(e.clientX, e.clientY, items);
  }

  return { rowMenu, bodyMenu, removeReal };
}