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
  clearChatHistory,
  deleteContact,
  getApiBase,
  listenEvents,
  loadBootstrap,
  loadInviteCode,
  loadMessages,
  markChatRead,
  openPrivateChat,
  renameContact,
  resolveInviteCode,
  saveContact,
  sendMessage,
  unblockPeer,
  logout,
} from "./lib/api";

import {
  invoke,
  isTauri,
} from "@tauri-apps/api/core";

import type {
  AppEvent,
  ChatSummary,
  Contact,
  InviteCode,
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
  buildContactDraft,
  buildEmptyContact,
  EMPTY_CONTACT,
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

  const [contactForm, setContactForm] =
    useState<Contact>(EMPTY_CONTACT);

  const [inviteCode, setInviteCode] =
    useState<InviteCode | null>(null);

  const [invitePeerIdDraft, setInvitePeerIdDraft] =
    useState("");

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
      ? snapshot.contacts.find(
          (item) =>
            item.peer_id ===
            selectedChat.peer_id,
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

    startTransition(() => {
      setSnapshot({
        ...nextSnapshot,
        online_users: nextSnapshot.online_users ?? [],
        neighbors: nextSnapshot.neighbors ?? [],
        contacts: nextSnapshot.contacts ?? [],
        blocked: nextSnapshot.blocked ?? [],
        chats: nextSnapshot.chats ?? [],
      });

      if (selectFirst && !selectedChatId) {
        const firstChat = nextSnapshot.chats?.find(
          (chat) => !hiddenChatIds.includes(chat.chat_id),
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
          }
          if (event.chat) {
            const chat = event.chat;
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

  async function handleOpenPeer(peerId: string, peerAddr?: string, name?: string) {
    try {
      setError("");
      const resolvedName = (name && name !== peerId) ? name : `Anonymous ${peerId.slice(-4)}`;
      const chat = await openPrivateChat({ peer_id: peerId, peer_addr: peerAddr, name: resolvedName });
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

  async function handleSaveContact() {
    if (!contactForm.name || !contactForm.peer_id || !contactForm.ip || !contactForm.port) {
      setError("Fill all contact fields");
      return;
    }
    try {
      setSaving(true);
      setError("");
      await saveContact(contactForm);
      await refreshBootstrap();
      setShowNewContactPopover(false);
      setContactForm(buildEmptyContact());
    } catch (err) {
      setError(describeError(err, "Failed to save contact"));
    } finally {
      setSaving(false);
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
        await renameContact(selectedChat.peer_id, peerNameDraft.trim());
      } else {
        const draft = buildContactDraft(selectedChat, selectedAddr);
        if (!draft.ip || !draft.port) {
          setError("Peer address is not known yet. Open the peer or add the contact manually.");
          return;
        }
        await saveContact({
          ...draft,
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

  async function handleDeleteContact(peerId?: string) {
    const targetPeerId = peerId ?? selectedChat?.peer_id;
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

  async function handleBlock() {
    if (!selectedChat) return;
    try {
      setSaving(true);
      setError("");
      await blockPeer({
        query: selectedChat.peer_id,
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
  async function handleOpenInvitePeer() {
    const code = invitePeerIdDraft.trim();
    if (!code) {
      setError("Enter a 6-digit code");
      return;
    }
    try {
      setSaving(true);
      setError("");
      const { peer_id } = await resolveInviteCode(code);
      await handleOpenPeer(peer_id);
      setInvitePeerIdDraft("");
      setShowNewContactPopover(false);
    } catch (err) {
      setError(describeError(err, "Failed to resolve invite code"));
    } finally {
      setSaving(false);
    }
  }
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

  async function openManualContactPopover() {
    setContactForm(buildEmptyContact());
    setInvitePeerIdDraft("");
    setInviteCode(null);
    setShowNewContactPopover(true);
    try {
      const invite = await loadInviteCode();
      setInviteCode(invite);
    } catch {
      setInviteCode({ code: "Unavailable", peer_id: "", expires_at: 0 });
    }
  }

  function prefillFromCurrentPeer() {
    setContactForm(buildContactDraft(selectedChat, selectedAddr));
    setShowNewContactPopover(true);
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

  function handleHideChat(chatId: string) {
    if (hiddenChatIds.includes(chatId)) {
      return;
    }
    persistHiddenChats([...hiddenChatIds, chatId]);
    setChatContextMenu(null);
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
            onOpenContact={(contact) => {
              setContactContextMenu(null);

              void handleOpenPeer(
                contact.peer_id,
                joinAddress(
                  contact.ip,
                  contact.port,
                ),
                contact.name ||
                  contact.peer_id,
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
            onNewContact={
              openManualContactPopover
            }
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
          onAddContact={
            prefillFromCurrentPeer
          }
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
          contactForm={contactForm}
          inviteCode={inviteCode}
          invitePeerIdDraft={
            invitePeerIdDraft
          }
          saving={saving}
          selectedChat={selectedChat}
          onClose={() =>
            setShowNewContactPopover(
              false,
            )
          }
          onInvitePeerIdChange={
            setInvitePeerIdDraft
          }
          onContactFormChange={
            setContactForm
          }
          onOpenInvitePeer={() => {
            void handleOpenInvitePeer();
          }}
          onPrefillCurrentPeer={
            prefillFromCurrentPeer
          }
          onSaveContact={() => {
            void handleSaveContact();
          }}
        />
      ) : null}

      <ErrorToast
        error={error}
        errorToastKey={
          errorToastKey
        }
      />

      <ContextMenus
        chatContextMenu={
          chatContextMenu
        }
        contactContextMenu={
          contactContextMenu
        }
        onHideChat={
          handleHideChat
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