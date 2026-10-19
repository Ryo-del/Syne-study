import { useEffect, useState, type FormEvent } from "react";
import type {
  AppIconId,
  AppLanguage,
  NotificationSound,
  SettingsSectionId,
  ThemePreference,
} from "../../config/settings";

import {
  APP_ICON_OPTIONS,
  LANGUAGE_OPTIONS,
  NOTIFICATION_SOUND_OPTIONS,
  SETTINGS_SECTIONS,
  THEME_OPTIONS,
} from "../../config/settings";
import { APP_VERSION } from "../../config/appVersion";
import { changePassword } from "../../lib/api";

interface SettingsPopoverProps {
  activeSettingsSection:
    | SettingsSectionId
    | null;

  showDeleteHistoryConfirm: boolean;

  notificationsEnabled: boolean;
  notificationPreview: boolean;
  notificationSound: NotificationSound;

  appLanguage: AppLanguage;

  themePreference: ThemePreference;
  resolvedTheme: "light" | "dark";

  selectedAppIcon: AppIconId;

  currentAppIcon: (typeof APP_ICON_OPTIONS)[number];

  autoLogoutEnabled: boolean;
  autoLogoutHours: number;
  onAutoLogoutEnabledChange: (value: boolean) => void;
  onAutoLogoutHoursChange: (value: number) => void;

  deleteHoldProgress: number;
  deletingHistory: boolean;

  t: (key: string) => string;

  onClose: () => void;

  onSectionChange: (
    section: SettingsSectionId | null,
  ) => void;

  onNotificationsEnabledChange: (
    value: boolean,
  ) => void;

  onNotificationPreviewChange: (
    value: boolean,
  ) => void;

  onNotificationSoundChange: (
    value: NotificationSound,
  ) => void;

  onLanguageChange: (
    value: AppLanguage,
  ) => void;

  onThemeChange: (
    value: ThemePreference,
  ) => void;

  onAppIconChange: (
    value: AppIconId,
  ) => void;

  onOpenDeleteHistoryConfirm: () => void;

  onCancelDeleteHistory: () => void;

  onStartDeleteHistoryHold: () => void;

  onStopDeleteHistoryHold: () => void;
}

export default function SettingsPopover({
  activeSettingsSection,
  showDeleteHistoryConfirm,
  notificationsEnabled,
  notificationPreview,
  notificationSound,
  appLanguage,
  themePreference,
  resolvedTheme,
  selectedAppIcon,
  currentAppIcon,
  autoLogoutEnabled,
  autoLogoutHours,
  onAutoLogoutEnabledChange,
  onAutoLogoutHoursChange,
  deleteHoldProgress,
  deletingHistory,
  t,
  onClose,
  onSectionChange,
  onNotificationsEnabledChange,
  onNotificationPreviewChange,
  onNotificationSoundChange,
  onLanguageChange,
  onThemeChange,
  onAppIconChange,
  onOpenDeleteHistoryConfirm,
  onCancelDeleteHistory,
  onStartDeleteHistoryHold,
  onStopDeleteHistoryHold,
}: SettingsPopoverProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [hoursInput, setHoursInput] = useState(String(autoLogoutHours));
  const [hoursError, setHoursError] = useState("");
  const [updateChecked, setUpdateChecked] = useState(false);

  useEffect(() => setHoursInput(String(autoLogoutHours)), [autoLogoutHours]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSaved(false);
    if (!currentPassword) return setPasswordError(t("system.passwordCurrentRequired"));
    if (newPassword.length < 6) return setPasswordError(t("system.passwordTooShort"));
    if (!/^[A-Za-z0-9]+$/.test(newPassword)) return setPasswordError(t("system.passwordCharacters"));
    if (newPassword !== repeatPassword) return setPasswordError(t("system.passwordMismatch"));
    setPasswordSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setPasswordSaved(true);
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      setPasswordError(message.includes("invalid current password") ? t("system.passwordCurrentInvalid") : t("system.passwordChangeFailed"));
    } finally {
      setPasswordSaving(false);
    }
  }

  function commitHours() {
    const value = Number(hoursInput);
    if (!Number.isInteger(value) || value < 1 || value > 24) {
      setHoursError(t("system.autoLogoutValidation"));
      setHoursInput(String(autoLogoutHours));
      return;
    }
    setHoursError("");
    onAutoLogoutHoursChange(value);
  }
  const activeSettingsItem =
    activeSettingsSection
      ? SETTINGS_SECTIONS.find(
          (item) =>
            item.id ===
            activeSettingsSection,
        ) ?? null
      : null;

  return (
    <>
      <div
        className="contact-popover-backdrop"
        onClick={onClose}
      />

      <div
        className="settings-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-popover-head">
          <div className="settings-popover-title">
            {activeSettingsItem ? (
              <button
                type="button"
                className="ghost-tiny"
                onClick={() =>
                  onSectionChange(null)
                }
              >
                {t("settings.back")}
              </button>
            ) : (
              <span className="settings-popover-kicker">
                {t(
                  "settings.preferences",
                )}
              </span>
            )}

            <h2 id="settings-title">
              {activeSettingsItem
                ? `${activeSettingsItem.icon} ${t(
                    activeSettingsItem.labelKey,
                  )}`
                : t("settings.title")}
            </h2>
          </div>

          <button
            type="button"
            className="ghost-tiny"
            onClick={onClose}
          >
            {t("settings.close")}
          </button>
        </div>

        {activeSettingsItem ? (
          activeSettingsSection ===
          "notifications" ? (
            <div className="settings-panel">
              <section className="settings-section-card">
                <label className="settings-toggle-row">
                  <span>
                    <strong>
                      {t(
                        "notifications.enabled",
                      )}
                    </strong>

                    <small>
                      {t(
                        "notifications.enabledMeta",
                      )}
                    </small>
                  </span>

                  <input
                    type="checkbox"
                    checked={
                      notificationsEnabled
                    }
                    onChange={(event) =>
                      onNotificationsEnabledChange(
                        event.target.checked,
                      )
                    }
                  />
                </label>

                <label className="settings-toggle-row">
                  <span>
                    <strong>
                      {t(
                        "notifications.preview",
                      )}
                    </strong>

                    <small>
                      {t(
                        "notifications.previewMeta",
                      )}
                    </small>
                  </span>

                  <input
                    type="checkbox"
                    checked={
                      notificationPreview
                    }
                    disabled={
                      !notificationsEnabled
                    }
                    onChange={(event) =>
                      onNotificationPreviewChange(
                        event.target.checked,
                      )
                    }
                  />
                </label>

                <label className="settings-field">
                  <span>
                    {t(
                      "notifications.sound",
                    )}
                  </span>

                  <select
                    value={
                      notificationSound
                    }
                    disabled={
                      !notificationsEnabled
                    }
                    onChange={(event) =>
                      onNotificationSoundChange(
                        event.target
                          .value as NotificationSound,
                      )
                    }
                  >
                    {NOTIFICATION_SOUND_OPTIONS.map(
                      (sound) => (
                        <option
                          key={sound.id}
                          value={
                            sound.id
                          }
                        >
                          {t(`sound.${sound.id}`)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </section>
            </div>
          ) : activeSettingsSection ===
            "language" ? (
            <div className="settings-panel">
              <section className="settings-section-card">
                <div className="appearance-section-head">
                  <span className="appearance-section-label">
                    {t(
                      "language.current",
                    )}
                  </span>

                  <span className="appearance-section-meta">
                    {
                      LANGUAGE_OPTIONS.find(
                        (item) =>
                          item.id ===
                          appLanguage,
                      )?.label
                    }
                  </span>
                </div>

                <div className="language-grid">
                  {LANGUAGE_OPTIONS.map(
                    (language) => (
                      <button
                        key={
                          language.id
                        }
                        type="button"
                        className={`appearance-choice ${
                          appLanguage ===
                          language.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          onLanguageChange(
                            language.id,
                          )
                        }
                      >
                        {
                          language.label
                        }
                      </button>
                    ),
                  )}
                </div>
              </section>
            </div>
          ) : activeSettingsSection ===
            "appearance" ? (
            <div className="appearance-panel">
              <section className="appearance-section">
                <div className="appearance-section-head">
                  <span className="appearance-section-label">
                    {t(
                      "appearance.theme",
                    )}
                  </span>

                  <span className="appearance-section-meta">
                    {resolvedTheme}
                  </span>
                </div>

                <div className="appearance-theme-grid">
                  {THEME_OPTIONS.map(
                    (theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`appearance-choice ${
                          themePreference ===
                          theme.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          onThemeChange(
                            theme.id,
                          )
                        }
                      >
                        {t(`theme.${theme.id}`)}
                      </button>
                    ),
                  )}
                </div>
              </section>

              <section className="appearance-section">
                <div className="appearance-section-head">
                  <span className="appearance-section-label">
                    {t(
                      "appearance.icon",
                    )}
                  </span>

                  <span className="appearance-section-meta">
                    {t(`icon.${currentAppIcon.id}`)}
                  </span>
                </div>

                <div className="appearance-icon-current">
                  <img
                    src={
                      currentAppIcon.src
                    }
                    alt={t(`icon.${currentAppIcon.id}`)}
                    className="appearance-icon-current-image"
                  />

                  <div className="appearance-icon-current-copy">
                    <strong>
                      {t(`icon.${currentAppIcon.id}`)}
                    </strong>

                    <span>
                      {t(
                        "appearance.saved",
                      )}
                    </span>
                  </div>
                </div>

                <div className="appearance-icon-grid">
                  {APP_ICON_OPTIONS.map(
                    (icon) => (
                      <button
                        key={icon.id}
                        type="button"
                        className={`appearance-icon-card ${
                          selectedAppIcon ===
                          icon.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          onAppIconChange(
                            icon.id,
                          )
                        }
                      >
                        <img
                          src={icon.src}
                          alt={t(`icon.${icon.id}`)}
                          className="appearance-icon-image"
                        />

                        <span>{t(`icon.${icon.id}`)}</span>
                      </button>
                    ),
                  )}
                </div>
              </section>
            </div>
          ) : activeSettingsSection === "system-settings" ? (
            <div className="settings-panel">
              <section className="settings-section-card">
                <label className="settings-toggle-row">
                  <span><strong>{t("system.autoLogout")}</strong><small>{t("system.autoLogoutMeta")}</small></span>
                  <input type="checkbox" checked={autoLogoutEnabled} onChange={(event) => onAutoLogoutEnabledChange(event.target.checked)} />
                </label>
                <label className="settings-field">
                  <span>{t("system.autoLogoutHours")}</span>
                  <input className="settings-input" type="number" min={1} max={24} step={1} value={hoursInput} disabled={!autoLogoutEnabled}
                    onChange={(event) => setHoursInput(event.target.value)} onBlur={commitHours}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitHours(); } }} />
                </label>
                {hoursError ? <div className="settings-form-error">{hoursError}</div> : null}
              </section>

              <section className="settings-section-card">
                <strong>{t("system.passwordTitle")}</strong>
                <form className="settings-password-form" onSubmit={(event) => void submitPassword(event)}>
                  <label className="settings-field"><span>{t("system.passwordCurrent")}</span><input className="settings-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                  <label className="settings-field"><span>{t("system.passwordNew")}</span><input className="settings-input" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                  <label className="settings-field"><span>{t("system.passwordRepeat")}</span><input className="settings-input" type="password" autoComplete="new-password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} /></label>
                  {passwordError ? <div className="settings-form-error">{passwordError}</div> : null}
                  {passwordSaved ? <div className="settings-form-success">{t("system.passwordChanged")}</div> : null}
                  <button type="submit" className="auth-button" disabled={passwordSaving}>{t("system.passwordChange")}</button>
                </form>
              </section>

              <section className="settings-section-card">
                <div className="settings-version-row"><strong>{t("system.version")}</strong><span>{APP_VERSION}</span></div>
                <button type="button" className="auth-button auth-button-secondary" onClick={() => setUpdateChecked(true)}>{t("system.checkUpdates")}</button>
                {updateChecked ? <div className="settings-form-success">{t("system.latestVersion")}</div> : null}
              </section>
            </div>
          ) : activeSettingsSection ===
            "delete-history" ? (
            <div className="settings-panel">
              <section className="settings-section-card danger-settings-card">
                <div className="settings-danger-copy">
                  <strong>
                    {t(
                      "deleteHistory.title",
                    )}
                  </strong>

                  <span>
                    {t(
                      "deleteHistory.description",
                    )}
                  </span>
                </div>

                <button
                  type="button"
                  className="danger-wide-btn"
                  onClick={
                    onOpenDeleteHistoryConfirm
                  }
                >
                  {t(
                    "deleteHistory.openConfirm",
                  )}
                </button>
              </section>
            </div>
          ) : (
            <div className="settings-panel-empty" />
          )
        ) : (
          <div className="settings-menu">
            {SETTINGS_SECTIONS.map(
              (section) => (
                <button
                  key={section.id}
                  type="button"
                  className="settings-menu-item"
                  onClick={() =>
                    onSectionChange(
                      section.id,
                    )
                  }
                >
                  <span>
                    {section.icon}{" "}
                    {t(
                      section.labelKey,
                    )}
                  </span>

                  <span
                    className="settings-menu-arrow"
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
              ),
            )}
          </div>
        )}
      </div>

      {showDeleteHistoryConfirm ? (
        <div
          className="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="confirm-dialog-copy">
            <strong>
              {t(
                "deleteHistory.confirmTitle",
              )}
            </strong>

            <span>
              {t(
                "deleteHistory.confirmDescription",
              )}
            </span>
          </div>

          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="ghost-tiny"
              onClick={
                onCancelDeleteHistory
              }
              disabled={deletingHistory}
            >
              {t(
                "deleteHistory.cancel",
              )}
            </button>

            <button
              type="button"
              className="hold-confirm-btn"
              style={
                {
                  "--hold-progress":
                    deleteHoldProgress,
                } as React.CSSProperties
              }
              onPointerDown={
                onStartDeleteHistoryHold
              }
              onPointerUp={
                onStopDeleteHistoryHold
              }
              onPointerLeave={
                onStopDeleteHistoryHold
              }
              onPointerCancel={
                onStopDeleteHistoryHold
              }
              disabled={deletingHistory}
            >
              <span>
                {deleteHoldProgress >
                0
                  ? t(
                      "deleteHistory.hold",
                    )
                  : t(
                      "deleteHistory.confirm",
                    )}
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
