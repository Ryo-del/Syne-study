import { invoke, isTauri } from "@tauri-apps/api/core";

import type {
  AppEvent,
  BlockedPeer,
  ChatSummary,
  Contact,
  DirectoryUser,
  InviteCode,
  Profile,
  Snapshot,
  UIMessage,
} from "../types";

const API_BASE =
  import.meta.env.VITE_API_BASE?.toString() ?? "http://127.0.0.1:38673";

export function getApiBase() {
  return API_BASE;
}

/** Ошибка локального API. code — код ответа файлового сервера (forbidden, exists, conflict...). */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 0, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Токен локального API. Его создаёт Tauri при запуске; в браузере без Tauri
// (npm run dev) защита выключена, и токен пустой.
let apiToken = "";
let tokenError = "";
const ready: Promise<void> = (async () => {
  if (!isTauri()) {
    return;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      apiToken = await invoke<string>("backend_token");
      tokenError = "";
      return;
    } catch (err) {
      tokenError = String(err);
      console.error("Failed to get the local API token:", err);
      await delay(200 * (attempt + 1));
    }
  }
})();

export function whenApiReady() {
  return ready;
}

/** Заголовки для запросов к локальному API вне request() (например, keepalive-fetch). */
export function authHeaders(): Record<string, string> {
  return apiToken ? { "X-Syne-Token": apiToken } : {};
}

function buildUrl(path: string) {
  try {
    return new URL(path, API_BASE).toString();
  } catch {
    throw new Error("Bridge address is invalid. Check the local backend.");
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function logout() {
  return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

function isTransientNetworkError(err: unknown) {
  if (!(err instanceof Error)) {
    return false;
  }
  const text = err.message.toLowerCase();
  return (
    text.includes("load failed") ||
    text.includes("fetch failed") ||
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error")
  );
}

/**
 * attempts: сколько раз повторять при сетевой ошибке до ответа сервера
 * (локальный backend мог ещё не подняться). Для длинных операций
 * (загрузка, скачивание) нужно 1, чтобы не повторять уже начатое.
 */
export async function request<T>(
  path: string,
  init?: RequestInit,
  attempts = 8,
): Promise<T> {
  await ready;
  const url = buildUrl(path);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
          ...(init?.headers ?? {}),
        },
      });

      if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        let code = "";
        try {
          const body = (await response.json()) as {
            error?: string;
            code?: string;
          };
          if (body.error) {
            message = body.error;
          }
          if (body.code) {
            code = body.code;
          }
        } catch {
          // тело ответа не JSON
        }
        throw new ApiError(message, response.status, code);
      }

      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    } catch (err) {
      lastError = err;
      if (
        err instanceof ApiError ||
        attempt === attempts - 1 ||
        !isTransientNetworkError(err)
      ) {
        break;
      }
      await delay(250 * (attempt + 1));
    }
  }

  if (lastError instanceof Error) {
    if (!(lastError instanceof ApiError) && isTransientNetworkError(lastError)) {
      throw new Error("Local backend is unavailable. Wait a moment and try again.");
    }
    throw lastError;
  }
  throw new Error("Local backend is unavailable. Wait a moment and try again.");
}

export function loadBootstrap() {
  return request<Snapshot>("/api/bootstrap");
}

export function setPeerId(peerId: string) {
  return request<Profile>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ peer_id: peerId }),
  });
}

export function loadMessages(chatId: string) {
  return request<UIMessage[]>(
    `/api/chats/${encodeURIComponent(chatId)}/messages`,
  );
}

export function openPrivateChat(payload: {
  peer_id: string;
  peer_addr?: string;
  name?: string;
  user_id?: string;
}) {
  return request<ChatSummary>("/api/chats/open", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function markChatRead(chatId: string) {
  return request<{ ok: true }>("/api/chats/read", {
    method: "POST",
    body: JSON.stringify({ chat_id: chatId }),
  });
}
export function deleteChat(chatId: string) {
  return request<{ ok: true }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
}
export function clearChatHistory() {
  return request<{ ok: true }>("/api/chats/history", {
    method: "DELETE",
  });
}

export function sendMessage(payload: {
  chat_id: string;
  target_id: string;
  text: string;
}) {
  return request<UIMessage>("/api/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loadInviteCode() {
  return request<InviteCode>("/api/invite");
}

export function resolveInviteCode(code: string) {
  return request<{ peer_id: string }>("/api/invite/resolve", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function saveContact(contact: Contact) {
  return request<Contact>("/api/contacts", {
    method: "POST",
    body: JSON.stringify(contact),
  });
}

export function renameContact(query: string, name: string) {
  return request<Contact>(`/api/contacts/${encodeURIComponent(query)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function searchDirectory(
  query: string,
  signal?: AbortSignal,
): Promise<DirectoryUser[]> {
  await ready;
  const url = new URL("/api/directory", getApiBase());
  if (query.trim()) url.searchParams.set("q", query.trim());
  const res = await fetch(url.toString(), { signal, headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function deleteContact(query: string) {
  return request<{ ok: true }>(`/api/contacts/${encodeURIComponent(query)}`, {
    method: "DELETE",
  });
}

export function blockPeer(payload: {
  query: string;
  reason?: string;
  name?: string;
  user_id?: string;
  peer_id?: string;
}) {
  return request<BlockedPeer>("/api/blocked", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function unblockPeer(query: string) {
  return request<{ ok: true }>(`/api/blocked/${encodeURIComponent(query)}`, {
    method: "DELETE",
  });
}

const EVENT_NAMES = [
  "chat_history_deleted",
  "chat_deleted",
  "peer_discovered",
  "online_snapshot",
  "online_user_updated",
  "message_received",
  "message_sent",
  "chat_updated",
  "chat_read",
  "contact_added",
  "contact_updated",
  "contact_deleted",
  "peer_blocked",
  "peer_unblocked",
  "file_transfer",
  "error",
];

export function listenEvents(onEvent: (event: AppEvent) => void) {
  let source: EventSource | null = null;
  let cancelled = false;

  void ready.then(() => {
    if (cancelled) {
      return;
    }
    // EventSource не умеет заголовки, поэтому токен идёт параметром.
    const url = new URL(buildUrl("/api/events"));
    if (apiToken) {
      url.searchParams.set("token", apiToken);
    }
    const es = new EventSource(url.toString());
    source = es;

    const forward = (nativeEvent: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(nativeEvent.data) as AppEvent);
      } catch {
        return;
      }
    };

    es.onerror = () => undefined;
    for (const name of EVENT_NAMES) {
      es.addEventListener(name, forward as EventListener);
    }
  });

  return () => {
    cancelled = true;
    source?.close();
  };
}