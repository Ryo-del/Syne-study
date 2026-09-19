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
                          {sound.label}
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
                        {theme.label}
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
                    {
                      currentAppIcon.label
                    }
                  </span>
                </div>

                <div className="appearance-icon-current">
                  <img
                    src={
                      currentAppIcon.src
                    }
                    alt={
                      currentAppIcon.label
                    }
                    className="appearance-icon-current-image"
                  />

                  <div className="appearance-icon-current-copy">
                    <strong>
                      {
                        currentAppIcon.label
                      }
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
                          alt={
                            icon.label
                          }
                          className="appearance-icon-image"
                        />

                        <span>
                          {icon.label}
                        </span>
                      </button>
                    ),
                  )}
                </div>
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