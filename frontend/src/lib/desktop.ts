import { invoke, isTauri } from "@tauri-apps/api/core";
import { downloadDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

/** Системный выбор папки. null — пользователь отказался (или это не окно Tauri). */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

/** Папка «Загрузки» пользователя. */
export async function defaultDownloadsDir(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  return downloadDir();
}

/** Временная папка для «Открыть как» (чистится при каждом запуске приложения). */
export function prepareOpenDir(): Promise<string> {
  return invoke<string>("open_temp_dir");
}

/** Системное окно «Открыть с помощью». Только для файлов из prepareOpenDir(). */
export async function openWithDialog(path: string): Promise<void> {
  await invoke("open_with_dialog", { path });
}

export interface NativeDrop {
  phase: "enter" | "over" | "drop" | "leave";
  paths: string[]; // у enter и drop
  x: number; // позиция курсора в CSS-пикселях окна (для leave — 0)
  y: number;
}

/**
 * Файлы, перетаскиваемые в окно с рабочего стола (настоящие пути).
 * Внутренние перетаскивания страницы сюда не попадают. Возвращает функцию отписки.
 */
export async function onNativeFileDrop(
  handler: (e: NativeDrop) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  const scale = await getCurrentWindow().scaleFactor();
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    switch (p.type) {
      case "enter":
        handler({ phase: "enter", paths: p.paths, x: p.position.x / scale, y: p.position.y / scale });
        break;
      case "over":
        handler({ phase: "over", paths: [], x: p.position.x / scale, y: p.position.y / scale });
        break;
      case "drop":
        handler({ phase: "drop", paths: p.paths, x: p.position.x / scale, y: p.position.y / scale });
        break;
      default:
        handler({ phase: "leave", paths: [], x: 0, y: 0 });
    }
  });
}