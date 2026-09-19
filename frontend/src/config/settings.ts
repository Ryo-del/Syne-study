import blueIcon from "../../src-tauri/icons/blue.jpeg";
import greenIcon from "../../src-tauri/icons/green.jpeg";
import orangeIcon from "../../src-tauri/icons/orange.jpeg";
import redIcon from "../../src-tauri/icons/red.jpeg";
import skyIcon from "../../src-tauri/icons/sky.jpeg";
import blackIcon from "../../src-tauri/icons/black.jpeg";

export const EMOJI_OPTIONS = [
  "🙂",
  "😎",
  "🤝",
  "🛰️",
  "🌿",
  "🔥",
  "🦊",
  "🐼",
  "😇",
  "🌙",
];

export type SidebarView =
  | "chats"
  | "contacts"
  | "network"
  | "blocked";

export type ThemePreference =
  | "system"
  | "light"
  | "dark";

export type NotificationSound =
  | "chime"
  | "pulse"
  | "soft"
  | "none";

export type AppLanguage =
  | "ru"
  | "en"
  | "fr"
  | "de";

export const SETTINGS_SECTIONS = [
  {
    id: "notifications",
    icon: "🔔",
    labelKey: "settings.notifications",
  },
  {
    id: "language",
    icon: "🌐",
    labelKey: "settings.language",
  },
  {
    id: "appearance",
    icon: "🎨",
    labelKey: "settings.appearance",
  },
  {
    id: "delete-history",
    icon: "🗑️",
    labelKey: "settings.deleteHistory",
  },
  {
    id: "sync-devices",
    icon: "📱",
    labelKey: "settings.syncDevices",
  },
  {
    id: "device-key",
    icon: "🔐",
    labelKey: "settings.deviceKey",
  },
  {
    id: "system-settings",
    icon: "⚙️",
    labelKey: "settings.systemSettings",
  },
] as const;

export type SettingsSectionId =
  (typeof SETTINGS_SECTIONS)[number]["id"];

export const THEME_OPTIONS: Array<{
  id: ThemePreference;
  label: string;
}> = [
  {
    id: "light",
    label: "Light",
  },
  {
    id: "dark",
    label: "Dark",
  },
  {
    id: "system",
    label: "System",
  },
];

export const APP_ICON_OPTIONS = [
  {
    id: "blue",
    label: "Blue",
    src: blueIcon,
  },
  {
    id: "green",
    label: "Green",
    src: greenIcon,
  },
  {
    id: "orange",
    label: "Orange",
    src: orangeIcon,
  },
  {
    id: "red",
    label: "Red",
    src: redIcon,
  },
  {
    id: "sky",
    label: "Sky",
    src: skyIcon,
  },
  {
    id: "black",
    label: "Black",
    src: blackIcon,
  },
] as const;

export type AppIconId =
  (typeof APP_ICON_OPTIONS)[number]["id"];

export const NOTIFICATION_SOUND_OPTIONS: Array<{
  id: NotificationSound;
  label: string;
}> = [
  {
    id: "chime",
    label: "Chime",
  },
  {
    id: "pulse",
    label: "Pulse",
  },
  {
    id: "soft",
    label: "Soft",
  },
  {
    id: "none",
    label: "None",
  },
];

export const LANGUAGE_OPTIONS: Array<{
  id: AppLanguage;
  label: string;
}> = [
  {
    id: "ru",
    label: "Русский",
  },
  {
    id: "en",
    label: "Английский",
  },
  {
    id: "fr",
    label: "Французский",
  },
  {
    id: "de",
    label: "Немецкий",
  },
];

export const APP_ICON_SIZE = 1024;
export const APP_ICON_VISIBLE_RATIO = 0.86;
export const APP_ICON_CORNER_RADIUS_RATIO = 0.223;

export const DELETE_HISTORY_HOLD_MS = 3000;