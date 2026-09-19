import type { AppLanguage } from "./settings";

export const TRANSLATIONS: Record<
  AppLanguage,
  Record<string, string>
> = {
  ru: {
    "settings.title": "Настройки",
    "settings.preferences": "Параметры",
    "settings.back": "Назад",
    "settings.close": "Закрыть",
    "settings.notifications": "Уведомления",
    "settings.language": "Язык",
    "settings.appearance": "Внешний вид",
    "settings.deleteHistory": "Удалить историю чата",
    "settings.syncDevices": "Синхронизация устройств",
    "settings.deviceKey": "Ключ устройства",
    "settings.systemSettings": "Системные настройки",

    "notifications.enabled": "Уведомления",
    "notifications.preview": "Предпросмотр",
    "notifications.sound": "Звук",
    "notifications.enabledMeta":
      "Показывать уведомления о новых сообщениях",
    "notifications.previewMeta":
      "Показывать текст сообщения в уведомлении",

    "language.current": "Текущий язык",

    "appearance.theme": "Тема",
    "appearance.icon": "Иконка",
    "appearance.saved":
      "Сохранено локально для этого устройства",

    "deleteHistory.title": "Удалить всю историю",
    "deleteHistory.description":
      "Будут удалены все переписки и сообщения на этом устройстве.",
    "deleteHistory.openConfirm":
      "Удалить всю историю",
    "deleteHistory.confirmTitle":
      "Вы точно хотите удалить всю историю переписок?",
    "deleteHistory.confirmDescription":
      "Это действие нельзя отменить. Удерживайте кнопку подтверждения 3 секунды.",
    "deleteHistory.cancel": "Отмена",
    "deleteHistory.confirm": "Подтвердить",
    "deleteHistory.hold": "Удерживайте...",
    "deleteHistory.deleted":
      "История переписок удалена",
    "deleteHistory.failed":
      "Не удалось удалить историю",
  },

  en: {
    "settings.title": "Settings",
    "settings.preferences": "Preferences",
    "settings.back": "Back",
    "settings.close": "Close",
    "settings.notifications": "Notifications",
    "settings.language": "Language",
    "settings.appearance": "Appearance",
    "settings.deleteHistory": "Delete chat history",
    "settings.syncDevices": "Sync devices",
    "settings.deviceKey": "Device key",
    "settings.systemSettings": "System settings",

    "notifications.enabled": "Notifications",
    "notifications.preview": "Preview",
    "notifications.sound": "Sound",
    "notifications.enabledMeta":
      "Show notifications for new messages",
    "notifications.previewMeta":
      "Show message text in notifications",

    "language.current": "Current language",

    "appearance.theme": "Theme",
    "appearance.icon": "Icon",
    "appearance.saved":
      "Saved locally for this device",

    "deleteHistory.title": "Delete all history",
    "deleteHistory.description":
      "All chats and messages on this device will be removed.",
    "deleteHistory.openConfirm":
      "Delete all history",
    "deleteHistory.confirmTitle":
      "Are you sure you want to delete all chat history?",
    "deleteHistory.confirmDescription":
      "This cannot be undone. Hold confirm for 3 seconds.",
    "deleteHistory.cancel": "Cancel",
    "deleteHistory.confirm": "Confirm",
    "deleteHistory.hold": "Keep holding...",
    "deleteHistory.deleted":
      "Chat history deleted",
    "deleteHistory.failed":
      "Failed to delete history",
  },

  fr: {
    "settings.title": "Paramètres",
    "settings.preferences": "Préférences",
    "settings.back": "Retour",
    "settings.close": "Fermer",
    "settings.notifications": "Notifications",
    "settings.language": "Langue",
    "settings.appearance": "Apparence",
    "settings.deleteHistory": "Supprimer l'historique",
    "settings.syncDevices": "Synchroniser les appareils",
    "settings.deviceKey": "Clé de l'appareil",
    "settings.systemSettings": "Paramètres système",

    "notifications.enabled": "Notifications",
    "notifications.preview": "Aperçu",
    "notifications.sound": "Son",
    "notifications.enabledMeta":
      "Afficher les notifications des nouveaux messages",
    "notifications.previewMeta":
      "Afficher le texte du message",

    "language.current": "Langue actuelle",

    "appearance.theme": "Thème",
    "appearance.icon": "Icône",
    "appearance.saved":
      "Enregistré localement sur cet appareil",

    "deleteHistory.title":
      "Supprimer tout l'historique",
    "deleteHistory.description":
      "Toutes les conversations et messages de cet appareil seront supprimés.",
    "deleteHistory.openConfirm":
      "Supprimer tout l'historique",
    "deleteHistory.confirmTitle":
      "Voulez-vous vraiment supprimer tout l'historique ?",
    "deleteHistory.confirmDescription":
      "Cette action est irréversible. Maintenez confirmer pendant 3 secondes.",
    "deleteHistory.cancel": "Annuler",
    "deleteHistory.confirm": "Confirmer",
    "deleteHistory.hold": "Maintenez...",
    "deleteHistory.deleted":
      "Historique supprimé",
    "deleteHistory.failed":
      "Impossible de supprimer l'historique",
  },

  de: {
    "settings.title": "Einstellungen",
    "settings.preferences": "Optionen",
    "settings.back": "Zurück",
    "settings.close": "Schließen",
    "settings.notifications":
      "Benachrichtigungen",
    "settings.language": "Sprache",
    "settings.appearance": "Darstellung",
    "settings.deleteHistory":
      "Chatverlauf löschen",
    "settings.syncDevices":
      "Geräte synchronisieren",
    "settings.deviceKey":
      "Geräteschlüssel",
    "settings.systemSettings":
      "Systemeinstellungen",

    "notifications.enabled":
      "Benachrichtigungen",
    "notifications.preview":
      "Vorschau",
    "notifications.sound": "Ton",
    "notifications.enabledMeta":
      "Benachrichtigungen für neue Nachrichten anzeigen",
    "notifications.previewMeta":
      "Nachrichtentext in Benachrichtigungen anzeigen",

    "language.current":
      "Aktuelle Sprache",

    "appearance.theme":
      "Design",
    "appearance.icon":
      "Icon",
    "appearance.saved":
      "Lokal auf diesem Gerät gespeichert",

    "deleteHistory.title":
      "Gesamten Verlauf löschen",
    "deleteHistory.description":
      "Alle Chats und Nachrichten auf diesem Gerät werden gelöscht.",
    "deleteHistory.openConfirm":
      "Gesamten Verlauf löschen",
    "deleteHistory.confirmTitle":
      "Möchten Sie wirklich den gesamten Chatverlauf löschen?",
    "deleteHistory.confirmDescription":
      "Dies kann nicht rückgängig gemacht werden. Halten Sie Bestätigen 3 Sekunden lang.",
    "deleteHistory.cancel":
      "Abbrechen",
    "deleteHistory.confirm":
      "Bestätigen",
    "deleteHistory.hold":
      "Gedrückt halten...",
    "deleteHistory.deleted":
      "Chatverlauf gelöscht",
    "deleteHistory.failed":
      "Verlauf konnte nicht gelöscht werden",
  },
};