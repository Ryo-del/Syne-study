import type {
  ChatSummary,
  Contact,
} from "../types";

export const EMPTY_CONTACT: Contact = {
  name: "",
  peer_id: "",
  ip: "192.168.",
  port: "",
};

export function buildEmptyContact(
  overrides?: Partial<Contact>,
): Contact {
  return {
    ...EMPTY_CONTACT,
    ...overrides,
  };
}

export function buildQuickContact(
  chat: ChatSummary,
  fallbackAddr?: string,
): Contact {
  const draft = buildContactDraft(chat, fallbackAddr);
  const hasAddr = draft.ip !== EMPTY_CONTACT.ip && draft.port !== "";
  return {
    ...draft,
    name: draft.name || `Anonymous ${(chat.peer_id || chat.peer_user_id || "").slice(-4)}`,
    user_id: chat.peer_user_id || undefined,
    ip: hasAddr ? draft.ip : "",
    port: hasAddr ? draft.port : "",
  };
}
export function buildContactDraft(
  chat: ChatSummary | null,
  fallbackAddr?: string,
): Contact {
  if (!chat) {
    return buildEmptyContact();
  }

  const addr =
    chat.known_addr || fallbackAddr || "";

  let ip = "";
  let port = "";

  if (addr.startsWith("/")) {
    const parts = addr.split("/");

    if (
      parts.length >= 5 &&
      (parts[1] === "ip4" ||
        parts[1] === "ip6")
    ) {
      ip = parts[2];
      port = parts[4];
    }
  } else {
    const index = addr.lastIndexOf(":");

    if (index === -1) {
      ip = addr.replace(
        /^\[|\]$/g,
        "",
      );
    } else {
      ip = addr
        .slice(0, index)
        .replace(
          /^\[|\]$/g,
          "",
        );

      port = addr.slice(index + 1);
    }
  }

  return buildEmptyContact({
    name:
      chat.title !== chat.peer_id
        ? chat.title
        : "",
    peer_id: chat.peer_id,
    ip: ip || EMPTY_CONTACT.ip,
    port,
  });
}