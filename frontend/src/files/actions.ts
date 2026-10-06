import { defaultDownloadsDir, openWithDialog, pickFolder, prepareOpenDir } from "../lib/desktop";
import { filesApi, newTransferId } from "./api";
import type { DownloadResult, FileEntry } from "./types";

function target(entry: FileEntry) {
  return { owner: entry.owner, path: entry.path, dir: entry.is_dir };
}

/** «Скачать» и «Скачать папку»: сразу в «Загрузки» (папка уходит архивом .zip). */
export async function downloadToDownloads(entry: FileEntry): Promise<DownloadResult> {
  const dir = await defaultDownloadsDir();
  if (!dir) {
    throw new Error("Downloads folder is unavailable");
  }
  return filesApi.download({ ...target(entry), dest_dir: dir, transfer_id: newTransferId() });
}

/** «Скачать как» и «Скачать папку как»: пользователь выбирает папку. null — отказался. */
export async function downloadAs(entry: FileEntry): Promise<DownloadResult | null> {
  const dir = await pickFolder("Куда скачать");
  if (!dir) {
    return null;
  }
  return filesApi.download({ ...target(entry), dest_dir: dir, transfer_id: newTransferId() });
}

/** «Открыть как»: скачивает во временную папку и показывает системное окно выбора программы. */
export async function openAs(entry: FileEntry): Promise<void> {
  if (entry.is_dir) {
    throw new Error("Only files can be opened");
  }
  const dir = await prepareOpenDir();
  const res = await filesApi.download({
    ...target(entry),
    dest_dir: dir,
    transfer_id: newTransferId(),
  });
  await openWithDialog(res.path);
}