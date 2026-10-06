import {
  type CSSProperties,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
    blockPeer,
  searchDirectory,
  clearChatHistory,
  deleteContact,
  getApiBase,
  listenEvents,
  loadBootstrap,
  loadMessages,
  markChatRead,
  openPrivateChat,
  renameContact,
  saveContact,
  sendMessage,
  deleteChat,
  unblockPeer,
  logout,
  authHeaders,
} from "./lib/api";

import {
  invoke,
  isTauri,
} from "@tauri-apps/api/core";

import type {
  AppEvent,
  DirectoryUser,
  Contact,
  ChatSummary,
  Snapshot,
  UIMessage,
} from "./types";

import {
  APP_ICON_OPTIONS,
  DELETE_HISTORY_HOLD_MS,
  LANGUAGE_OPTIONS,
  NOTIFICATION_SOUND_OPTIONS,
  SETTINGS_SECTIONS,
  type AppIconId,
  type AppLanguage,
  type NotificationSound,
  type SettingsSectionId,
  type SidebarView,
  type ThemePreference,
} from "./config/settings";

import { TRANSLATIONS } from "./config/translations";
import { ensureNotificationPermission, notifyNewMessage } from "./lib/notify";
import {
  readStorage,
  writeStorage,
} from "./lib/storage";

import {
  describeError,
  getInitial,
  joinAddress,
} from "./lib/format";

import {
  buildQuickContact,
} from "./lib/contacts";

import {
  upsertChat,
  upsertNeighbor,
  upsertOnlineUser,
} from "./lib/chats";

import {
  loadRoundedIconBytes,
} from "./lib/icons";
import IconRail from "./components/layout/IconRail";
import PeersPanel from "./components/layout/PeersPanel";
import ChatArea from "./components/chat/ChatArea";
import SettingsPopover from "./components/settings/SettingsPopover";
import ContactPopover from "./components/contacts/ContactPopover";
import ErrorToast from "./components/common/ErrorToast";
import ContextMenus from "./components/common/ContextMenus";
import AuthGate from "./components/auth/AuthGate";
import NearbyPanel from "./components/nearby/NearbyPanel";

const EMPTY_SNAPSHOT: Snapshot = {
  local_id: "",
  port: 0,
  contacts: [],
  blocked: [],
  neighbors: [],
  online_users: [],
  chats: [],
};
const LIVE_REFRESH_INTERVAL_MS = 2000;
export default function App() {
  const [snapshot, setSnapshot] =
    useState<Snapshot>(EMPTY_SNAPSHOT);

  const [selectedChatId, setSelectedChatId] =
    useState("");

  const [messages, setMessages] =
    useState<Record<string, UIMessage[]>>({});

  const [hiddenChatIds, setHiddenChatIds] =
    useState<string[]>(() =>
      readStorage(
        "syne.hidden_chat_ids",
        [],
      ),
    );

  const [chatContextMenu, setChatContextMenu] =
    useState<{
      chatId: string;
      x: number;
      y: number;
    } | null>(null);

  const [contactContextMenu, setContactContextMenu] =
    useState<{
      peerId: string;
      x: number;
      y: number;
    } | null>(null);

  const [query, setQuery] =
    useState("");

  const [nearbyQuery, setNearbyQuery] =
    useState("");

  const [composer, setComposer] =
    useState("");

  const [error, setError] =
    useState("");
  const [authenticated, setAuthenticated] = 
    useState(false);
  const [errorToastKey, setErrorToastKey] =
    useState(0);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [showNewContactPopover, setShowNewContactPopover] =
    useState(false);

  const [blockReason, setBlockReason] =
    useState("");

  const [editingPeerName, setEditingPeerName] =
    useState(false);

  const [peerNameDraft, setPeerNameDraft] =
    useState("");

  const [showDetailPanel, setShowDetailPanel] =
    useState(false);

  const [sidebarView, setSidebarView] =
    useState<SidebarView>("chats");

  const [showSettings, setShowSettings] =
    useState(false);
    
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId | null>(null);

  const [themePreference, setThemePreference] =
    useState<ThemePreference>(() =>
      readStorage(
        "syne.theme_preference",
        "system",
      ),
    );
useEffect(() => {
  void ensureNotificationPermission();
}, []);
  const [notificationsEnabled, setNotificationsEnabled] =
    useState(() =>
      readStorage(
        "syne.notifications_enabled",
        true,
      ),
    );

  const [notificationPreview, setNotificationPreview] =
    useState(() =>
      readStorage(
        "syne.notification_preview",
        true,
      ),
    );

  const [notificationSound, setNotificationSound] =
    useState<NotificationSound>(() => {
      const stored =
        readStorage<string>(
          "syne.notification_sound",
          "chime",
        );

      return NOTIFICATION_SOUND_OPTIONS.some(
        (item) => item.id === stored,
      )
        ? (stored as NotificationSound)
        : "chime";
    });
    
  const [appLanguage, setAppLanguage] =
    useState<AppLanguage>(() => {
      const stored =
        readStorage<string>(
          "syne.language",
          "ru",
        );

      return LANGUAGE_OPTIONS.some(
        (item) => item.id === stored,
      )
        ? (stored as AppLanguage)
        : "ru";
    });
    const notificationsEnabledRef = useRef(notificationsEnabled);
const notificationPreviewRef = useRef(notificationPreview);

useEffect(() => {
  notificationsEnabledRef.current = notificationsEnabled;
}, [notificationsEnabled]);

useEffect(() => {
  notificationPreviewRef.current = notificationPreview;
}, [notificationPreview]);
  const [selectedAppIcon, setSelectedAppIcon] =
    useState<AppIconId>(() => {
      const stored =
        readStorage<string>(
          "syne.app_icon",
          "blue",
        );

      return APP_ICON_OPTIONS.some(
        (item) => item.id === stored,
      )
        ? (stored as AppIconId)
        : "blue";
    });

  const [systemTheme, setSystemTheme] =
    useState<"light" | "dark">(() => {
      if (typeof window === "undefined") {
        return "dark";
      }

      return window.matchMedia(
        "(prefers-color-scheme: light)",
      ).matches
        ? "light"
        : "dark";
    });

  const [emojiPickerTarget, setEmojiPickerTarget] =
    useState<"self" | "peer" | null>(null);

  const [selfEmoji, setSelfEmoji] =
    useState(() =>
      readStorage(
        "syne.self_emoji",
        "🙂",
      ),
    );

  const [peerEmojis, setPeerEmojis] =
    useState<Record<string, string>>(() =>
      readStorage(
        "syne.peer_emojis",
        {},
      ),
    );

  const [
    showDeleteHistoryConfirm,
    setShowDeleteHistoryConfirm,
  ] = useState(false);

  const [
    deleteHoldProgress,
    setDeleteHoldProgress,
  ] = useState(0);

  const [
    deletingHistory,
    setDeletingHistory,
  ] = useState(false);

  
 const messageStreamRef =
  useRef<HTMLDivElement>(null);

  const pendingScrollBehaviorRef =
    useRef<ScrollBehavior | null>(null);

  const deleteHoldTimerRef =
    useRef<number | null>(null);

  const deleteHoldFrameRef =
    useRef<number | null>(null);

  const deleteHoldStartedAtRef =
    useRef(0);
    const hiddenChatIdsRef = useRef(hiddenChatIds);

  useEffect(() => {
    hiddenChatIdsRef.current = hiddenChatIds;
  }, [hiddenChatIds]);
   const selectedChatIdRef = useRef(selectedChatId);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);
  const deferredQuery =
    useDeferredValue(query);
  const visibleChats = useMemo(
    () =>
      snapshot.chats.filter(
        (item) =>
          !hiddenChatIds.includes(
            item.chat_id,
          ),
      ),
    [
      hiddenChatIds,
      snapshot.chats,
    ],
  );

  const selectedChat =
    visibleChats.find(
      (item) =>
        item.chat_id === selectedChatId,
    ) ?? null;
    
  const selectedContact =
  selectedChat
    ? snapshot.contacts.find((c) =>
        c.user_id && selectedChat.peer_user_id
          ? c.user_id === selectedChat.peer_user_id
          : !!c.peer_id && c.peer_id === selectedChat.peer_id,
      ) ?? null
    : null;
  const selectedPeer =
    selectedChat
      ? snapshot.neighbors.find(
          (item) =>
            item.peer_id ===
            selectedChat.peer_id,
        ) ?? null
      : null;

  const selectedMessages =
    selectedChat
      ? messages[
          selectedChat.chat_id
        ] ?? []
      : [];

  const selectedAddr =
    selectedChat?.known_addr ||
    selectedPeer?.addr ||
    "";
  const selectedPeerEmoji =
    selectedChat
      ? peerEmojis[
          selectedChat.peer_id
        ] ??
        getInitial(
          selectedChat.title ||
            selectedChat.peer_id,
        )
      : "🙂";

  const t = (key: string) =>
    TRANSLATIONS[appLanguage][key] ??
    TRANSLATIONS.en[key] ??
    key;
  async function refreshBootstrap(selectFirst = false) {
  try {
    const nextSnapshot = await loadBootstrap();

    // Открытый чат всегда считается прочитанным
    const nextChats = (nextSnapshot.chats ?? []).map((chat) =>
      chat.chat_id === selectedChatIdRef.current
        ? { ...chat, unread_count: 0 }
        : chat,
    );

    startTransition(() => {
      setSnapshot({
        ...nextSnapshot,
        online_users: nextSnapshot.online_users ?? [],
        neighbors: nextSnapshot.neighbors ?? [],
        contacts: nextSnapshot.contacts ?? [],
        blocked: nextSnapshot.blocked ?? [],
        chats: nextChats,
      });

      if (selectFirst && !selectedChatIdRef.current) {
        const firstChat = nextChats.find(
          (chat) => !hiddenChatIdsRef.current.includes(chat.chat_id),
        );

        if (firstChat) {
          setSelectedChatId(firstChat.chat_id);
        }
      }
    });
  } catch (err) {
    setError(
      describeError(
        err,
        "Failed to refresh application data",
      ),
    );
  }
}
async function refreshMessages(chatId: string) {
  const nextMessages = await loadMessages(chatId);

  setMessages((current) => ({
    ...current,
    [chatId]: nextMessages,
  }));
}
  const resolvedTheme =
    themePreference === "system"
      ? systemTheme
      : themePreference;

  const currentAppIcon =
    APP_ICON_OPTIONS.find(
      (item) =>
        item.id === selectedAppIcon,
    ) ??
    APP_ICON_OPTIONS[0];

useEffect(() => {
  if (!isTauri()) {
    return;
  }

  let cancelled = false;

  async function applyAppIcon() {
    try {
      const iconBytes =
        await loadRoundedIconBytes(
          currentAppIcon.src,
        );

      if (!iconBytes || cancelled) {
        return;
      }

      await invoke("set_app_icon", {
        iconBytes: Array.from(iconBytes),
      });
    } catch (err) {
      console.error(
        "Failed to apply app icon:",
        err,
      );
    }
  }

  void applyAppIcon();

  return () => {
    cancelled = true;
  };
}, [currentAppIcon.src]);

  // Подписка на живые события бэкенда (новые сообщения, изменения чатов,
  // появление/исчезновение людей в сети и т.д.). Без этого UI показывал бы
  // только то, что было на момент первого bootstrap-запроса.
  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const unsubscribe = listenEvents((event: AppEvent) => {
      switch (event.type) {
              case "message_received":
        case "message_sent": {
          if (event.message) {
            const msg = event.message;
            setMessages((current) => {
              const existing = current[msg.chat_id] ?? [];
              if (
                existing.some(
                  (item) => item.message_id === msg.message_id,
                )
              ) {
                return current;
              }
              return {
                ...current,
                [msg.chat_id]: [...existing, msg],
              };
            });

            if (event.type === "message_received") {
              unhideChat(msg.chat_id);

              // Чат открыт прямо сейчас: сообщение считается прочитанным
              if (msg.chat_id === selectedChatIdRef.current) {
                void markChatRead(msg.chat_id).catch(() => {});
              }

              // notifyNewMessage сам молчит, если окно в фокусе
              void notifyNewMessage({
                title: event.chat?.title || "Syne",
                body: msg.text,
                enabled: notificationsEnabledRef.current,
                preview: notificationPreviewRef.current,
              });
            }
          }
          if (event.chat) {
            // Бэкенд уже посчитал +1 непрочитанное, а для открытого чата гасим сразу,
            // не дожидаясь ответа markChatRead
            const isOpenChat =
              event.type === "message_received" &&
              event.chat.chat_id === selectedChatIdRef.current;
            const chat = isOpenChat
              ? { ...event.chat, unread_count: 0 }
              : event.chat;
            setSnapshot((current) => ({
              ...current,
              chats: upsertChat(current.chats, chat),
            }));
          }
          break;
        }

        case "chat_updated":
        case "chat_read": {
          if (event.chat) {
            const chat = event.chat;
            setSnapshot((current) => ({
              ...current,
              chats: upsertChat(current.chats, chat),
            }));
          }
          break;
        }

        case "peer_discovered": {
          if (event.peer) {
            const peer = event.peer;
            setSnapshot((current) => upsertNeighbor(current, peer));
          }
          break;
        }

        case "online_user_updated": {
          if (event.online_user) {
            const onlineUser = event.online_user;
            setSnapshot((current) =>
              upsertOnlineUser(current, onlineUser),
            );
          }
          break;
        }

        // Эти события меняют структуру, которую проще перечитать целиком,
        // чем аккуратно патчить по кусочкам.
        case "online_snapshot":
        case "contact_added":
        case "contact_updated":
        case "contact_deleted":
        case "peer_blocked":
        case "peer_unblocked":
        case "chat_history_deleted": {
          void refreshBootstrap();
          break;
        }

        case "error": {
          if (event.error) {
            setError(event.error);
            setErrorToastKey((key) => key + 1);
          }
          break;
        }

        default:
          break;
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);
  useEffect(() => {
    if (!authenticated) return;

    const intervalId = window.setInterval(() => {
      void refreshBootstrap();
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [authenticated]);
  const filteredChats = useMemo(() => {
    const needle =
      deferredQuery
        .trim()
        .toLowerCase();

    if (!needle) {
      return visibleChats;
    }

    return visibleChats.filter(
      (item) =>
        item.title
          .toLowerCase()
          .includes(needle) ||
        item.peer_id
          .toLowerCase()
          .includes(needle),
    );
  }, [
    deferredQuery,
    visibleChats,
  ]);

  const filteredNearbyPeers =
    useMemo(() => {
      const needle =
        deferredQuery
          .trim()
          .toLowerCase();

      if (!needle) {
        return snapshot.neighbors;
      }

      return snapshot.neighbors.filter(
        (item) =>
          (item.name || "")
            .toLowerCase()
            .includes(needle) ||
          item.peer_id
            .toLowerCase()
            .includes(needle) ||
          item.addr
            .toLowerCase()
            .includes(needle),
      );
    }, [
      deferredQuery,
      snapshot.neighbors,
    ]);

   const filteredOnlineUsers =
    useMemo(() => {
      const users = snapshot.online_users ?? [];
      const needle =
        deferredQuery
          .trim()
          .toLowerCase();

      if (!needle) {
        return users;
      }

      return users.filter(
        (item) =>
          `${item.sname ?? ""} ${item.fname ?? ""}`
            .trim()
            .toLowerCase()
            .includes(needle) ||
          item.user_id
            .toLowerCase()
            .includes(needle),
      );
    }, [
      deferredQuery,
      snapshot.online_users,
    ]);

  const filteredContacts =
    useMemo(() => {
      const needle =
        deferredQuery
          .trim()
          .toLowerCase();

      if (!needle) {
        return snapshot.contacts;
      }

      return snapshot.contacts.filter(
        (item) =>
          item.name
            .toLowerCase()
            .includes(needle) ||
          item.peer_id
            .toLowerCase()
            .includes(needle) ||
          item.ip
            .toLowerCase()
            .includes(needle) ||
          item.port
            .toLowerCase()
            .includes(needle),
      );
    }, [
      deferredQuery,
      snapshot.contacts,
    ]);

  const filteredBlockedPeers =
    useMemo(() => {
      const needle =
        deferredQuery
          .trim()
          .toLowerCase();

      if (!needle) {
        return snapshot.blocked;
      }

      return snapshot.blocked.filter(
        (item) =>
          (item.name || "")
            .toLowerCase()
            .includes(needle) ||
          item.peer_id
            .toLowerCase()
            .includes(needle) ||
          (item.reason || "")
            .toLowerCase()
            .includes(needle),
      );
    }, [
      deferredQuery,
      snapshot.blocked,
    ]);

  const sidebarTitle =
    sidebarView === "chats"
      ? "Chats"
      : sidebarView === "contacts"
        ? "Contacts"
        : sidebarView === "network"
          ? "Nearby"
          : "Black list";

  const sidebarBadge =
    sidebarView === "chats"
      ? `${filteredChats.length}`
      : sidebarView === "contacts"
        ? `${filteredContacts.length}`
        : sidebarView === "network"
          ? `${
              filteredOnlineUsers.length +
              filteredNearbyPeers.length
            }`
          : `${filteredBlockedPeers.length}`;

  const searchPlaceholder =
    sidebarView === "chats"
      ? "Search chats..."
      : sidebarView === "contacts"
        ? "Search contacts..."
        : sidebarView === "network"
          ? "Search nearby peers..."
          : "Search blocked peers...";

 async function handleOpenPeer(
  peerId: string,
  peerAddr?: string,
  name?: string,
  userId?: string,
) {
  try {
    setError("");
    const resolvedName =
      name && name !== peerId
        ? name
        : `Anonymous ${(peerId || userId || "").slice(-4)}`;
    const chat = await openPrivateChat({
      peer_id: peerId,
      peer_addr: peerAddr,
      name: resolvedName,
      user_id: userId,
    });
      unhideChat(chat.chat_id);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          chats: upsertChat(current.chats, chat),
        }));
        setSelectedChatId(chat.chat_id);
      });
      setSidebarView("chats");
      try {
        await refreshMessages(chat.chat_id);
      } catch (err) {
        setError(describeError(err, "Failed to load chat history"));
      }
    } catch (err) {
      setError(describeError(err, "Failed to open chat"));
    }
  }

  async function handleSend() {
    if (!selectedChat || !composer.trim()) {
      return;
    }
    const text = composer.trim();
    setComposer("");
    pendingScrollBehaviorRef.current = "smooth";
    try {
      setError("");
      await sendMessage({
        chat_id: selectedChat.chat_id,
        target_id: selectedChat.peer_id,
        text,
      });
    } catch (err) {
      pendingScrollBehaviorRef.current = null;
      setComposer(text);
      setError(describeError(err, "Failed to send message"));
    }
  }

  
  async function handleCommitPeerName() {
    if (!selectedChat || !peerNameDraft.trim()) {
      setEditingPeerName(false);
      return;
    }
    try {
      setSaving(true);
      setError("");
     if (selectedContact) {
  await renameContact(
    selectedContact.user_id || selectedContact.peer_id,
    peerNameDraft.trim(),
  );
} else {
  await saveContact({
    ...buildQuickContact(selectedChat, selectedAddr),
    name: peerNameDraft.trim(),
  });
}
      
      await refreshBootstrap();
      setEditingPeerName(false);
    } catch (err) {
      setError(describeError(err, "Failed to save peer name"));
    } finally {
      setSaving(false);
    }
  }
async function addContact(contact: Contact) {
  try {
    setSaving(true);
    setError("");
    await saveContact(contact);
    await refreshBootstrap();
  } catch (err) {
    setError(describeError(err, "Failed to save contact"));
  } finally {
    setSaving(false);
  }
}

// Плюс в окне New contact
function handleAddDirectoryUser(user: DirectoryUser) {
  return addContact({
    name: `${user.fname} ${user.sname}`.trim() || user.login,
    user_id: user.login,
    peer_id: user.peer_id,
    ip: "",
    port: "",
  });
}

// Кнопка "Add contact" над чатом: сразу в контакты, без окон
function handleQuickAddContact() {
  if (!selectedChat || selectedContact) return;
  return addContact(buildQuickContact(selectedChat, selectedAddr));
}

async function handleOpenContact(contact: Contact) {
  await handleOpenPeer(
    contact.peer_id,
  
    contact.name || contact.peer_id,
    contact.user_id,
  );
}
  async function handleDeleteContact(peerId?: string) {
    const targetPeerId =
  peerId ??
  (selectedContact
    ? selectedContact.user_id || selectedContact.peer_id
    : selectedChat?.peer_id);
    if (!targetPeerId) return;
    try {
      setSaving(true);
      setError("");
      await deleteContact(targetPeerId);
      setContactContextMenu(null);
      await refreshBootstrap();
    } catch (err) {
      setError(describeError(err, "Failed to delete contact"));
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
  if (import.meta.env.DEV) return; // в dev оставляем консоль для отладки

  // Убираем стандартное меню (Save as / Print / Inspect).
  // Свои меню (чаты, контакты) продолжают работать: они вызывают свой preventDefault.
  const onContextMenu = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea")) return; // копировать/вставить в полях
    e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const blocked =
      e.key === "F12" ||
      (mod && e.shiftKey && ["i", "j", "c"].includes(k)) || // DevTools
      (e.metaKey && e.altKey && ["i", "j"].includes(k)) ||  // DevTools на macOS
      (mod && ["p", "s", "u"].includes(k));                 // Print, Save as, View source
    if (blocked) e.preventDefault();
  };

  window.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    window.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}, []);
  async function handleBlock() {
  if (!selectedChat) return;
  try {
    setSaving(true);
    setError("");
    await blockPeer({
      query: selectedChat.peer_user_id || selectedChat.peer_id,
      user_id: selectedChat.peer_user_id,
      peer_id: selectedChat.peer_id,
      name: selectedChat.title,
      reason: blockReason.trim(),
    });
    setBlockReason("");
    await refreshBootstrap();
  } catch (err) {
    setError(describeError(err, "Failed to block peer"));
  } finally {
    setSaving(false);
  }
}

  async function handleUnblock(peerId: string) {
    try {
      setSaving(true);
      setError("");
      await unblockPeer(peerId);
      await refreshBootstrap();
    } catch (err) {
      setError(describeError(err, "Failed to unblock peer"));
    } finally {
      setSaving(false);
    }
  }
  async function handleLogout() {
  try { await logout(); } catch (err) { setError(describeError(err, "Failed to log out")); }
  startTransition(() => {
    setAuthenticated(false);
    setSnapshot(EMPTY_SNAPSHOT);
    setMessages({});
    setSelectedChatId("");
    setComposer("");
    setShowDetailPanel(false);
    setSidebarView("chats");
    setLoading(true);
  });
}

// выгрузка данных, если окно закрыли без выхода
useEffect(() => {
  if (!authenticated) return;
  const onUnload = () => {
    void fetch(new URL("/api/auth/logout", getApiBase()).toString(), { method: "POST", keepalive: true });
  };
  window.addEventListener("beforeunload", onUnload);
  return () => window.removeEventListener("beforeunload", onUnload);
}, [authenticated]);
    const onUnload = () => {
    void fetch(new URL("/api/auth/logout", getApiBase()).toString(), {
      method: "POST",
      keepalive: true,
      headers: authHeaders(),
    });
  };
  function handleSettings() {
    setActiveSettingsSection(null);
    setShowSettings(true);
  }

  function stopDeleteHistoryHold() {
    if (deleteHoldTimerRef.current !== null) {
      window.clearTimeout(deleteHoldTimerRef.current);
      deleteHoldTimerRef.current = null;
    }
    if (deleteHoldFrameRef.current !== null) {
      window.cancelAnimationFrame(deleteHoldFrameRef.current);
      deleteHoldFrameRef.current = null;
    }
    deleteHoldStartedAtRef.current = 0;
    setDeleteHoldProgress(0);
  }
  
  async function confirmDeleteHistory() {
    stopDeleteHistoryHold();
    try {
      setDeletingHistory(true);
      setError("");
      await clearChatHistory();
      startTransition(() => {
        setMessages({});
        setSnapshot((current) => ({ ...current, chats: [] }));
        setSelectedChatId("");
        setHiddenChatIds([]);
      });
      writeStorage("syne.hidden_chat_ids", []);
      setShowDeleteHistoryConfirm(false);
      setError(t("deleteHistory.deleted"));
      await refreshBootstrap(false);
    } catch (err) {
      setError(describeError(err, t("deleteHistory.failed")));
    } finally {
      setDeletingHistory(false);
    }
  }

  function startDeleteHistoryHold() {
    if (deletingHistory || deleteHoldTimerRef.current !== null) {
      return;
    }
    deleteHoldStartedAtRef.current = window.performance.now();
    const updateProgress = () => {
      const elapsed = window.performance.now() - deleteHoldStartedAtRef.current;
      setDeleteHoldProgress(Math.min(1, elapsed / DELETE_HISTORY_HOLD_MS));
      if (elapsed < DELETE_HISTORY_HOLD_MS) {
        deleteHoldFrameRef.current = window.requestAnimationFrame(updateProgress);
      }
    };
    updateProgress();
    deleteHoldTimerRef.current = window.setTimeout(() => {
      deleteHoldTimerRef.current = null;
      void confirmDeleteHistory();
    }, DELETE_HISTORY_HOLD_MS);
  }

  function closeSettings() {
    stopDeleteHistoryHold();
    setShowDeleteHistoryConfirm(false);
    setShowSettings(false);
    setActiveSettingsSection(null);
  }

  

  function updateSelfEmoji(nextEmoji: string) {
    setSelfEmoji(nextEmoji);
    writeStorage("syne.self_emoji", nextEmoji);
    setEmojiPickerTarget(null);
  }

  // Обобщённая функция: ставит эмодзи для произвольного peer_id — используется
  // и из чата (через updatePeerEmoji ниже), и напрямую из вкладки Nearby.
  function setPeerEmoji(peerId: string, nextEmoji: string) {
    const nextMap = {
      ...peerEmojis,
      [peerId]: nextEmoji,
    };
    setPeerEmojis(nextMap);
    writeStorage("syne.peer_emojis", nextMap);
  }

  function updatePeerEmoji(nextEmoji: string) {
    if (!selectedChat) return;
    setPeerEmoji(selectedChat.peer_id, nextEmoji);
    setEmojiPickerTarget(null);
  }

  function getPeerAvatar(peerId: string, label: string) {
    return peerEmojis[peerId] ?? getInitial(label);
  }

  function persistHiddenChats(nextIds: string[]) {
    setHiddenChatIds(nextIds);
    writeStorage("syne.hidden_chat_ids", nextIds);
  }
    function unhideChat(chatId: string) {
    const current = hiddenChatIdsRef.current;
    if (!current.includes(chatId)) return;
    const next = current.filter((id) => id !== chatId);
    hiddenChatIdsRef.current = next;
    setHiddenChatIds(next);
    writeStorage("syne.hidden_chat_ids", next);
  }
    async function handleDeleteChat(chatId: string) {
    setChatContextMenu(null);
    try {
      setError("");
      await deleteChat(chatId);
      startTransition(() => {
        setMessages((current) => {
          const { [chatId]: _removed, ...rest } = current;
          return rest;
        });
        setSnapshot((current) => ({
          ...current,
          chats: current.chats.filter((c) => c.chat_id !== chatId),
        }));
        if (selectedChatIdRef.current === chatId) {
          setSelectedChatId("");
        }
      });
    } catch (err) {
      setError(describeError(err, "Failed to delete chat"));
    }
  }
  function handleChatContextMenu(event: React.MouseEvent, chatId: string) {
    event.preventDefault();
    event.stopPropagation();
    setChatContextMenu({
      chatId,
      x: event.clientX,
      y: event.clientY,
    });
    setContactContextMenu(null);
  }

  function handleContactContextMenu(event: React.MouseEvent, peerId: string) {
    event.preventDefault();
    event.stopPropagation();
    setContactContextMenu({
      peerId,
      x: event.clientX,
      y: event.clientY,
    });
    setChatContextMenu(null);
  }
  useEffect(() => {
  if (!authenticated || !selectedChatId) return;
  let cancelled = false;
  (async () => {
    try {
      const items = await loadMessages(selectedChatId);
      if (!cancelled) {
        setMessages((cur) => ({ ...cur, [selectedChatId]: items }));
      }
    } catch (err) {
      if (!cancelled) setError(describeError(err, "Failed to load chat history"));
    }
    try { await markChatRead(selectedChatId); } catch { /* ignore */ }
  })();
  return () => { cancelled = true; };
}, [authenticated, selectedChatId]);
const previousChatIdRef = useRef<string>("");

  useEffect(() => {
    const container = messageStreamRef.current;
    if (!container) return;

    const isChatSwitch = previousChatIdRef.current !== selectedChatId;
    previousChatIdRef.current = selectedChatId;

    const behavior: ScrollBehavior =
      pendingScrollBehaviorRef.current ?? (isChatSwitch ? "auto" : "smooth");
    pendingScrollBehaviorRef.current = null;

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, [selectedMessages, selectedChatId]);
  if (!authenticated) {
  return (
    <AuthGate
      onAuthenticated={() => {
        setAuthenticated(true);
        void refreshBootstrap(true).finally(() => setLoading(false));
      }}
    />
  );
}

  return (
    <>
      <div className="app-shell">
        <IconRail
          sidebarView={sidebarView}
          showSettings={showSettings}
          emojiPickerTarget={
            emojiPickerTarget
          }
          selfEmoji={selfEmoji}
          onEmojiTargetChange={
            setEmojiPickerTarget
          }
          onSelfEmojiChange={
            updateSelfEmoji
          }
          onSidebarViewChange={
            setSidebarView
          }
          onSettings={handleSettings}
          onLogout={() => {
            void handleLogout();
          }}
        />

                {sidebarView === "network" ? (
          <NearbyPanel
            users={snapshot.online_users ?? []}
            query={nearbyQuery}
            onQueryChange={setNearbyQuery}
            getPeerAvatar={getPeerAvatar}
            onSetPeerEmoji={setPeerEmoji}
            onOpenPeer={(peerId, peerAddr, name) => {
              void handleOpenPeer(peerId, peerAddr, name);
            }}
          />
        ) : (
          <PeersPanel
            sidebarView={sidebarView}
            sidebarTitle={sidebarTitle}
            sidebarBadge={sidebarBadge}
            searchPlaceholder={
              searchPlaceholder
            }
            query={query}
            onQueryChange={setQuery}
            filteredChats={filteredChats}
            filteredNearbyPeers={
              filteredNearbyPeers
            }
            filteredOnlineUsers={
              filteredOnlineUsers
            }
            filteredContacts={
              filteredContacts
            }
            filteredBlockedPeers={
              filteredBlockedPeers
            }
            selectedChatId={
              selectedChatId
            }
            onSelectChat={(chatId) => {
              setChatContextMenu(null);
              setSelectedChatId(chatId);
            }}
            onOpenPeer={(
              peerId,
              peerAddr,
              name,
            ) => {
              void handleOpenPeer(
                peerId,
                peerAddr,
                name,
              );
            }}
            
            onChatContextMenu={
              handleChatContextMenu
            }
            onContactContextMenu={
              handleContactContextMenu
            }
            getPeerAvatar={
              getPeerAvatar
            }
            onUnblock={(peerId) => {
  void handleUnblock(peerId);
}}
onNewContact={() => setShowNewContactPopover(true)}
onOpenContact={(contact) => {
  setContactContextMenu(null);
  void handleOpenContact(contact);
}}
          />
        )}

        <ChatArea
          selectedChat={selectedChat}
          selectedContact={
            selectedContact
          }
          selectedPeerEmoji={
            selectedPeerEmoji
          }
          selectedAddr={selectedAddr}
          selectedMessages={
            selectedMessages
          }
          loading={loading}
          apiBase={getApiBase()}
          showDetailPanel={
            showDetailPanel
          }
          setShowDetailPanel={
            setShowDetailPanel
          }
          emojiPickerTarget={
            emojiPickerTarget
          }
          editingPeerName={
            editingPeerName
          }
          peerNameDraft={
            peerNameDraft
          }
          blockReason={blockReason}
          saving={saving}
          composer={composer}
          messageStreamRef={
            messageStreamRef
          }
          onAddContact={() => { void handleQuickAddContact(); }}
          onComposerChange={
            setComposer
          }
          onSend={() => {
            void handleSend();
          }}
          onEmojiTargetChange={
            setEmojiPickerTarget
          }
          onPeerEmojiChange={
            updatePeerEmoji
          }
          onPeerNameEditing={
            setEditingPeerName
          }
          onPeerNameDraftChange={
            setPeerNameDraft
          }
          onCommitPeerName={() => {
            void handleCommitPeerName();
          }}
          onBlockReasonChange={
            setBlockReason
          }
          onBlock={() => {
            void handleBlock();
          }}
        />
      </div>

      {showSettings ? (
        <SettingsPopover
          activeSettingsSection={
            activeSettingsSection
          }
          showDeleteHistoryConfirm={
            showDeleteHistoryConfirm
          }
          notificationsEnabled={
            notificationsEnabled
          }
          notificationPreview={
            notificationPreview
          }
          notificationSound={
            notificationSound
          }
          appLanguage={appLanguage}
          themePreference={
            themePreference
          }
          resolvedTheme={
            resolvedTheme
          }
          selectedAppIcon={
            selectedAppIcon
          }
          currentAppIcon={
            currentAppIcon
          }
          deleteHoldProgress={
            deleteHoldProgress
          }
          deletingHistory={
            deletingHistory
          }
          t={t}
          onClose={closeSettings}
          onSectionChange={
            setActiveSettingsSection
          }
          onNotificationsEnabledChange={
            setNotificationsEnabled
          }
          onNotificationPreviewChange={
            setNotificationPreview
          }
          onNotificationSoundChange={
            setNotificationSound
          }
          onLanguageChange={
            setAppLanguage
          }
          onThemeChange={
            setThemePreference
          }
          onAppIconChange={
            setSelectedAppIcon
          }
          onOpenDeleteHistoryConfirm={() =>
            setShowDeleteHistoryConfirm(
              true,
            )
          }
          onCancelDeleteHistory={() => {
            stopDeleteHistoryHold();

            setShowDeleteHistoryConfirm(
              false,
            );
          }}
          onStartDeleteHistoryHold={
            startDeleteHistoryHold
          }
          onStopDeleteHistoryHold={
            stopDeleteHistoryHold
          }
        />
      ) : null}

      {showNewContactPopover ? (
  <ContactPopover
    contacts={snapshot.contacts}
    saving={saving}
    getPeerAvatar={getPeerAvatar}
    onAdd={(user) => { void handleAddDirectoryUser(user); }}
    onClose={() => setShowNewContactPopover(false)}
  />
) : null}

      <ErrorToast
  error={error}
  errorToastKey={errorToastKey}
  onClose={() => setError("")}
/>

      <ContextMenus
        chatContextMenu={
          chatContextMenu
        }
        contactContextMenu={
          contactContextMenu
        }
        onHideChat={
          handleDeleteChat
        }
        onDeleteContact={(peerId) => {
          void handleDeleteContact(
            peerId,
          );
        }}
      />
    </>
  );
}