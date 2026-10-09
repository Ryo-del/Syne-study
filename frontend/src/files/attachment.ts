export type AttachmentKind = "photo" | "file";

/** Вложение-файл в тексте сообщения. Сам файл лежит в «Полученные» у получателя. */
export interface FileAttachment {
  v: 1;
  kind: AttachmentKind;
  name: string;
  size: number;
  /** Логин получателя: скачать копию может только он. */
  to: string;
  /** Путь копии в папке получателя. */
  path: string;
  /** Исходник у отправителя (owner "" — свой), чтобы он видел своё вложение. */
  src?: { owner: string; path: string };
}

const OPEN = "[[syne-file:";
const CLOSE = "]]";
const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];

export function isImageName(name: string): boolean {
  const i = name.lastIndexOf(".");
  return i > 0 && IMAGE_EXT.includes(name.slice(i + 1).toLowerCase());
}

function toB64(s: string): string {
  let bin = "";
  new TextEncoder().encode(s).forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function fromB64(b: string): string {
  const bin = atob(b);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeAttachment(a: FileAttachment): string {
  return `${a.kind === "photo" ? "📷" : "📎"} ${a.name}\n${OPEN}${toB64(JSON.stringify(a))}${CLOSE}`;
}

export function parseAttachment(text: string): FileAttachment | null {
  const i = text.indexOf(OPEN);
  if (i < 0) return null;
  const j = text.indexOf(CLOSE, i + OPEN.length);
  if (j < 0) return null;
  try {
    const o = JSON.parse(fromB64(text.slice(i + OPEN.length, j))) as Partial<FileAttachment>;
    if (
      !o ||
      o.v !== 1 ||
      typeof o.name !== "string" ||
      typeof o.path !== "string" ||
      typeof o.size !== "number" ||
      typeof o.to !== "string"
    ) {
      return null;
    }
    const src =
      o.src && typeof o.src.owner === "string" && typeof o.src.path === "string"
        ? { owner: o.src.owner, path: o.src.path }
        : undefined;
    const kind: AttachmentKind =
      o.kind === "photo" || (o.kind === undefined && isImageName(o.name)) ? "photo" : "file";
    return { v: 1, kind, name: o.name, size: o.size, to: o.to, path: o.path, src };
  } catch {
    return null;
  }
}

/** Для превью чата и уведомлений. */
export function attachmentPreview(text: string): string {
  const a = parseAttachment(text);
  if (!a) return text;
  return a.kind === "photo" ? "📷 Фото" : `📎 ${a.name}`;
}