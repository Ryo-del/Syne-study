export type FileAction =
  | "view"
  | "download"
  | "copy"
  | "send"
  | "edit"
  | "paste"
  | "delete";

/** Производные возможности: отдельно не настраиваются. */
export type FileCap = "open" | "rename" | "duplicate";

export type RuleMode = "all" | "contacts" | "selected" | "none";

export type ConflictPolicy = "rename" | "replace" | "skip";

/** Порядок, в котором права показываются в диалоге. */
export const FILE_ACTIONS: FileAction[] = [
  "view",
  "download",
  "copy",
  "send",
  "edit",
  "paste",
  "delete",
];

export type FileErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "exists"
  | "quota_exceeded"
  | "invalid_path"
  | "invalid_request"
  | "conflict"
  | "invalid_encoding"
  | "internal";

export interface FileEntry {
  name: string; // для корня чужой папки — «Фамилия Имя» владельца
  path: string; // относительно папки владельца, разделитель "/"
  is_dir: boolean;
  size: number;
  mod_time: number; // unix ms
  owner: string; // логин владельца папки
  owner_name: string; // «Фамилия Имя» владельца
  snippet?: string; // поиск: строка с совпадением в содержимом
  can?: Partial<Record<FileAction | FileCap, boolean>>;
}

export interface AclRule {
  action: FileAction;
  mode: RuleMode;
  users?: string[];
  inherited: boolean;
}

export interface QuotaInfo {
  used_bytes: number;
  limit_bytes: number;
  unlimited: boolean;
}

export interface FilesResponse {
  ok: boolean;
  entry?: FileEntry;
  entries?: FileEntry[];
  truncated?: boolean;
  rules?: AclRule[];
  quota?: QuotaInfo;
  data?: string;
  skipped?: number;
}

export interface FileText {
  entry: FileEntry;
  text: string;
}

export interface DownloadResult {
  path: string;
  bytes: number;
  skipped?: number;
}

export interface UploadResult {
  uploaded: number;
  skipped: number;
  failed?: { path: string; error: string }[];
  /** Имена, которые уже есть на сервере: загрузка не начата, нужно выбрать политику. */
  conflicts?: string[];
  items?: FileEntry[];
}

export interface Ref {
  owner?: string; // пусто — своя папка
  path?: string;
}