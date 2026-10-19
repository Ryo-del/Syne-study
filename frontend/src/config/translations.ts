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
      "Применяется только в этой сессии",
    "theme.light": "Светлая",
    "theme.dark": "Тёмная",
    "theme.system": "Системная",
    "icon.blue": "Синий",
    "icon.green": "Зелёный",
    "icon.orange": "Оранжевый",
    "icon.red": "Красный",
    "icon.sky": "Голубой",
    "icon.black": "Чёрный",
    "sound.chime": "Звонок",
    "sound.pulse": "Импульс",
    "sound.soft": "Мягкий",
    "sound.none": "Без звука",
    "system.passwordTitle": "Изменение пароля",
    "system.passwordCurrent": "Текущий пароль",
    "system.passwordNew": "Новый пароль",
    "system.passwordRepeat": "Повторите новый пароль",
    "system.passwordChange": "Изменить пароль",
    "system.passwordCurrentRequired": "Введите текущий пароль",
    "system.passwordCurrentInvalid": "Неверный текущий пароль",
    "system.passwordTooShort": "Новый пароль должен содержать не менее 6 символов",
    "system.passwordCharacters": "Используйте только латинские буквы и цифры",
    "system.passwordMismatch": "Пароли не совпадают",
    "system.passwordChangeFailed": "Не удалось изменить пароль",
    "system.passwordChanged": "Пароль изменён. Остальные сессии завершены.",
    "system.autoLogout": "Автоматический выход",
    "system.autoLogoutMeta": "Выйти через заданное время после входа",
    "system.autoLogoutHours": "Часов до выхода",
    "system.autoLogoutValidation": "Укажите целое число от 1 до 24",
    "system.autoLogoutWarning": "Автоматический выход через 1 минуту",
    "system.checkUpdates": "Проверить обновления",
    "system.latestVersion": "У вас установлена последняя версия",
    "system.version": "Версия Syne",

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
      "Applies only for this session",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",
    "icon.blue": "Blue",
    "icon.green": "Green",
    "icon.orange": "Orange",
    "icon.red": "Red",
    "icon.sky": "Sky",
    "icon.black": "Black",
    "sound.chime": "Chime",
    "sound.pulse": "Pulse",
    "sound.soft": "Soft",
    "sound.none": "No sound",
    "system.passwordTitle": "Change password",
    "system.passwordCurrent": "Current password",
    "system.passwordNew": "New password",
    "system.passwordRepeat": "Repeat new password",
    "system.passwordChange": "Change password",
    "system.passwordCurrentRequired": "Enter your current password",
    "system.passwordCurrentInvalid": "Current password is incorrect",
    "system.passwordTooShort": "New password must be at least 6 characters",
    "system.passwordCharacters": "Use Latin letters and digits only",
    "system.passwordMismatch": "Passwords do not match",
    "system.passwordChangeFailed": "Could not change password",
    "system.passwordChanged": "Password changed. Other sessions were signed out.",
    "system.autoLogout": "Automatic sign out",
    "system.autoLogoutMeta": "Sign out after this time from login",
    "system.autoLogoutHours": "Hours until sign out",
    "system.autoLogoutValidation": "Enter a whole number from 1 to 24",
    "system.autoLogoutWarning": "Automatic sign out in 1 minute",
    "system.checkUpdates": "Check for updates",
    "system.latestVersion": "You have the latest version installed",
    "system.version": "Syne version",

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
      "Appliqué uniquement à cette session",
    "theme.light": "Clair",
    "theme.dark": "Sombre",
    "theme.system": "Système",
    "icon.blue": "Bleu",
    "icon.green": "Vert",
    "icon.orange": "Orange",
    "icon.red": "Rouge",
    "icon.sky": "Bleu ciel",
    "icon.black": "Noir",
    "sound.chime": "Carillon",
    "sound.pulse": "Impulsion",
    "sound.soft": "Doux",
    "sound.none": "Aucun son",
    "system.passwordTitle": "Changer le mot de passe",
    "system.passwordCurrent": "Mot de passe actuel",
    "system.passwordNew": "Nouveau mot de passe",
    "system.passwordRepeat": "Répéter le nouveau mot de passe",
    "system.passwordChange": "Modifier le mot de passe",
    "system.passwordCurrentRequired": "Saisissez le mot de passe actuel",
    "system.passwordCurrentInvalid": "Mot de passe actuel incorrect",
    "system.passwordTooShort": "Le nouveau mot de passe doit contenir au moins 6 caractères",
    "system.passwordCharacters": "Utilisez uniquement des lettres latines et des chiffres",
    "system.passwordMismatch": "Les mots de passe ne correspondent pas",
    "system.passwordChangeFailed": "Impossible de modifier le mot de passe",
    "system.passwordChanged": "Mot de passe modifié. Les autres sessions sont déconnectées.",
    "system.autoLogout": "Déconnexion automatique",
    "system.autoLogoutMeta": "Se déconnecter après ce délai à partir de la connexion",
    "system.autoLogoutHours": "Heures avant la déconnexion",
    "system.autoLogoutValidation": "Saisissez un entier de 1 à 24",
    "system.autoLogoutWarning": "Déconnexion automatique dans 1 minute",
    "system.checkUpdates": "Vérifier les mises à jour",
    "system.latestVersion": "La dernière version est installée",
    "system.version": "Version de Syne",

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
      "Nur in dieser Sitzung angewendet",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "theme.system": "System",
    "icon.blue": "Blau",
    "icon.green": "Grün",
    "icon.orange": "Orange",
    "icon.red": "Rot",
    "icon.sky": "Himmelblau",
    "icon.black": "Schwarz",
    "sound.chime": "Glockenspiel",
    "sound.pulse": "Impuls",
    "sound.soft": "Sanft",
    "sound.none": "Kein Ton",
    "system.passwordTitle": "Passwort ändern",
    "system.passwordCurrent": "Aktuelles Passwort",
    "system.passwordNew": "Neues Passwort",
    "system.passwordRepeat": "Neues Passwort wiederholen",
    "system.passwordChange": "Passwort ändern",
    "system.passwordCurrentRequired": "Geben Sie Ihr aktuelles Passwort ein",
    "system.passwordCurrentInvalid": "Das aktuelle Passwort ist falsch",
    "system.passwordTooShort": "Das neue Passwort muss mindestens 6 Zeichen enthalten",
    "system.passwordCharacters": "Nur lateinische Buchstaben und Ziffern verwenden",
    "system.passwordMismatch": "Die Passwörter stimmen nicht überein",
    "system.passwordChangeFailed": "Passwort konnte nicht geändert werden",
    "system.passwordChanged": "Passwort geändert. Andere Sitzungen wurden abgemeldet.",
    "system.autoLogout": "Automatische Abmeldung",
    "system.autoLogoutMeta": "Nach dieser Zeit ab der Anmeldung abmelden",
    "system.autoLogoutHours": "Stunden bis zur Abmeldung",
    "system.autoLogoutValidation": "Geben Sie eine ganze Zahl von 1 bis 24 ein",
    "system.autoLogoutWarning": "Automatische Abmeldung in 1 Minute",
    "system.checkUpdates": "Nach Updates suchen",
    "system.latestVersion": "Die neueste Version ist installiert",
    "system.version": "Syne-Version",

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
