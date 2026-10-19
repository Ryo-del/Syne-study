import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri } from "@tauri-apps/api/core";
import type { NotificationSound } from "../config/settings";

function playNotificationSound(sound: NotificationSound) {
  if (sound === "none") return;
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const notes = sound === "pulse" ? [660, 880] : sound === "soft" ? [440] : [784, 988];
    let start = context.currentTime;
    for (const frequency of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(sound === "soft" ? 0.035 : 0.07, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
      start += 0.13;
    }
    window.setTimeout(() => void context.close(), 600);
  } catch {
    // Audio can be unavailable until the app receives a user gesture.
  }
}

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
  sound: NotificationSound;
}) {
  if (!isTauri() || !params.enabled) return;

  const win = getCurrentWindow();
  const focused = await win.isFocused();
  if (focused) return;

  playNotificationSound(params.sound);
  await sendNotification({
    title: params.title,
    body: params.preview ? params.body : "New message",
  });
}
