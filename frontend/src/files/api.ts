import { request } from "../lib/api";
import type {
  AclRule,
  ConflictPolicy,
  DownloadResult,
  FileAction,
  FileEntry,
  FilesResponse,
  FileText,
  QuotaInfo,
  Ref,
  RuleMode,
  UploadResult,
} from "./types";

function call(op: string, body: Record<string, unknown> = {}) {
  return request<FilesResponse>("/api/files/call", {
    method: "POST",
    body: JSON.stringify({ op, ...body }),
  });
}

export function newTransferId() {
  return crypto.randomUUID();
}

export const filesApi = {
  /** Папки других пользователей, в которых для меня что-то открыто («Сервер»). */
  async listOwners(): Promise<FileEntry[]> {
    return (await call("list_owners")).entries ?? [];
  },

  async list(owner: string, path: string) {
    const r = await call("list", { owner, path });
    return { entries: r.entries ?? [], truncated: !!r.truncated };
  },

  async stat(owner: string, path: string): Promise<FileEntry | undefined> {
    return (await call("stat", { owner, path })).entry;
  },

  async mkdir(owner: string, parent: string, name: string) {
    return (await call("mkdir", { owner, path: parent, name })).entry;
  },

  async createFile(owner: string, parent: string, name: string) {
    return (await call("create", { owner, path: parent, name })).entry;
  },

  async rename(owner: string, path: string, name: string) {
    return (await call("rename", { owner, path, name })).entry;
  },

  async remove(owner: string, path: string) {
    await call("delete", { owner, path });
  },

  /** Копирование: src вставляется в папку dest. */
  async paste(src: Ref, dest: Ref, onConflict?: ConflictPolicy) {
    const r = await call("paste", {
      owner: src.owner ?? "",
      path: src.path ?? "",
      dest_owner: dest.owner ?? "",
      dest_path: dest.path ?? "",
      on_conflict: onConflict ?? "",
    });
    return { entry: r.entry, skipped: r.skipped ?? 0 };
  },

  async duplicate(owner: string, path: string) {
    return (await call("duplicate", { owner, path })).entry;
  },

  // ----- права -----

  async rulesGet(owner: string, path: string): Promise<AclRule[]> {
    return (await call("rules_get", { owner, path })).rules ?? [];
  },

  async ruleSet(
    owner: string,
    path: string,
    action: FileAction,
    mode: RuleMode,
    users: string[] = [],
  ): Promise<AclRule[]> {
    const r = await call("rule_set", { owner, path, action, mode, users });
    return r.rules ?? [];
  },

  async ruleClear(
    owner: string,
    path: string,
    action: FileAction,
  ): Promise<AclRule[]> {
    return (await call("rule_clear", { owner, path, action })).rules ?? [];
  },

  async quota(owner = ""): Promise<QuotaInfo | undefined> {
    return (await call("quota", { owner })).quota;
  },

  // ----- избранное и состояние интерфейса -----

  async favAdd(owner: string, path: string) {
    return (await call("fav_add", { owner, path })).entry;
  },

  async favRemove(owner: string, path: string) {
    await call("fav_remove", { owner, path });
  },

  async favList(): Promise<FileEntry[]> {
    return (await call("fav_list")).entries ?? [];
  },

  async uiGet<T>(): Promise<T | null> {
    const data = (await call("ui_get")).data;
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  },

  async uiPut(state: unknown) {
    await call("ui_put", { data: JSON.stringify(state) });
  },

  // ----- поиск и отправка -----

  async search(
    query: string,
    opts: { content?: boolean; owner?: string; limit?: number } = {},
  ) {
    const r = await call("search", {
      query,
      content: !!opts.content,
      owner: opts.owner ?? "",
      limit: opts.limit ?? 0,
    });
    return { entries: r.entries ?? [], truncated: !!r.truncated };
  },

  /** Копия файла в папке «Полученные» получателя; в ответе путь копии. */
  async send(owner: string, path: string, toUser: string) {
    return (await call("send", { owner, path, dest_owner: toUser })).entry;
  },

  // ----- содержимое -----

  readText(owner: string, path: string) {
    return request<FileText>(
      "/api/files/read-text",
      { method: "POST", body: JSON.stringify({ owner, path }) },
      1,
    );
  },

  /** baseModTime — mod_time версии, с которой начали правку. Конфликт: ApiError с code "conflict". */
  async writeText(owner: string, path: string, text: string, baseModTime: number) {
    const r = await request<{ entry?: FileEntry }>(
      "/api/files/write-text",
      {
        method: "POST",
        body: JSON.stringify({ owner, path, text, base_mod_time: baseModTime }),
      },
      1,
    );
    return r.entry;
  },

  /** Скачать на диск. Прогресс приходит событиями file_transfer с тем же transfer_id. */
  download(p: {
    owner: string;
    path: string;
    dir: boolean;
    dest_dir?: string;
    dest_path?: string;
    transfer_id?: string;
  }) {
    return request<DownloadResult>(
      "/api/files/download",
      { method: "POST", body: JSON.stringify(p) },
      1,
    );
  },

  /**
   * Загрузить файлы и папки с компьютера (пути из нативного перетаскивания).
   * Если имена уже заняты и политика не выбрана, вернётся conflicts без загрузки.
   */
  upload(p: {
    owner: string;
    path: string;
    local_paths: string[];
    on_conflict?: ConflictPolicy;
    transfer_id?: string;
  }) {
    return request<UploadResult>(
      "/api/files/upload",
      { method: "POST", body: JSON.stringify(p) },
      1,
    );
  },

  cancelTransfer(transferId: string) {
    return request<{ ok: boolean }>("/api/files/cancel", {
      method: "POST",
      body: JSON.stringify({ transfer_id: transferId }),
    });
  },
};