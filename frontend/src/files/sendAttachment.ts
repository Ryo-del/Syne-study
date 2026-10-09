import { ApiError, sendMessage } from "../lib/api";
import { filesApi, newTransferId } from "./api";
import { encodeAttachment, isImageName } from "./attachment";
import { describeFileError } from "./errors";
import { baseName, isJunkName } from "./hidden";
import type { FileEntry } from "./types";

/** Папка на сервере, куда попадают файлы, отправленные с компьютера. */
export const SENT_DIR = "Отправленные";

export interface ChatTarget {
  chat_id: string;
  peer_id: string;
  peer_user_id?: string;
}

export interface SendReport {
  sent: number;
  errors: string[];
}

/** Копия файла в «Полученные» получателя и сообщение-вложение в чат. owner — как ждёт API ("" — свой). */
async function deliver(chat: ChatTarget, owner: string, entry: FileEntry): Promise<void> {
  const to = chat.peer_user_id;
  if (!to) throw new Error("У этого чата нет аккаунта получателя");
  const copy = await filesApi.send(owner, entry.path, to);
  const name = copy?.name || entry.name;
  await sendMessage({
    chat_id: chat.chat_id,
    target_id: chat.peer_id,
    text: encodeAttachment({
      v: 1,
      kind: isImageName(name) ? "photo" : "file",
      name,
      size: entry.size,
      to,
      path: copy?.path ?? "",
      src: { owner, path: entry.path },
    }),
  });
}

/** Файлы и фото с компьютера: загрузка в «Отправленные», затем отправка. */
export async function sendLocalFiles(
  chat: ChatTarget,
  paths: string[],
  onTransfer: (id: string, label: string) => void,
): Promise<SendReport> {
  const report: SendReport = { sent: 0, errors: [] };
  const list = paths.filter((p) => !isJunkName(baseName(p)));
  if (list.length === 0) {
    report.errors.push("Нет файлов для отправки");
    return report;
  }

  const id = newTransferId();
  onTransfer(id, list.length === 1 ? baseName(list[0]) : `файлов: ${list.length}`);

  try {
    await filesApi.mkdir("", "", SENT_DIR);
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "exists")) {
      report.errors.push(describeFileError(err));
      return report;
    }
  }

  let res: Awaited<ReturnType<typeof filesApi.upload>>;
  try {
    res = await filesApi.upload({
      owner: "",
      path: SENT_DIR,
      local_paths: list,
      on_conflict: "rename",
      files_only: true,
      transfer_id: id,
    });
  } catch (err) {
    report.errors.push(describeFileError(err));
    return report;
  }

  for (const f of res.failed ?? []) report.errors.push(`${baseName(f.path)}: ${f.error}`);
  const items = res.items ?? [];
  if (res.uploaded > items.length) {
    report.errors.push("Часть файлов загружена в «Отправленные», но не отправлена: отправьте их из Files");
  }
  for (const entry of items) {
    try {
      await deliver(chat, "", entry);
      report.sent += 1;
    } catch (err) {
      report.errors.push(`${entry.name}: ${describeFileError(err)}`);
    }
  }
  return report;
}

/** Файлы, выбранные в Files. owner — как ждёт API ("" — свой). */
export async function sendServerFiles(
  chat: ChatTarget,
  picks: { owner: string; entry: FileEntry }[],
): Promise<SendReport> {
  const report: SendReport = { sent: 0, errors: [] };
  for (const p of picks) {
    try {
      await deliver(chat, p.owner, p.entry);
      report.sent += 1;
    } catch (err) {
      report.errors.push(`${p.entry.name}: ${describeFileError(err)}`);
    }
  }
  return report;
}