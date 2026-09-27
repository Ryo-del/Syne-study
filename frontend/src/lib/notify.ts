import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri } from "@tauri-apps/api/core";

export async function ensureNotificationPermission() {
  if (!isTauri()) return false;
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  return granted;
}

export async function notifyNewMessage(params: {
  title: string;
  body: string;
  enabled: boolean;
  preview: boolean;
}) {
  if (!isTauri() || !params.enabled) return;

  const win = getCurrentWindow();
  const focused = await win.isFocused();
  if (focused) return;

  await sendNotification({
    title: params.title,
    body: params.preview ? params.body : "New message",
  });
}