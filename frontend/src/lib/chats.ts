import type { ChatSummary, Snapshot } from "../types";

export function upsertChat(
  chats: ChatSummary[],
  incoming: ChatSummary,
) {
  const next = chats.filter(
    (item) =>
      item.chat_id !== incoming.chat_id,
  );

  next.unshift(incoming);

  next.sort((a, b) => {
    if (
      a.last_timestamp ===
      b.last_timestamp
    ) {
      return a.title.localeCompare(
        b.title,
      );
    }

    return (
      b.last_timestamp -
      a.last_timestamp
    );
  });

  return next;
}

export function upsertNeighbor(
  snapshot: Snapshot,
  incoming: Snapshot["neighbors"][number],
) {
  const neighbors = snapshot.neighbors
    .filter(
      (item) =>
        item.peer_id !==
        incoming.peer_id,
    )
    .concat(incoming)
    .sort(
      (a, b) =>
        b.last_seen - a.last_seen,
    );

  const hasContactAlias =
    snapshot.contacts.some(
      (item) =>
        item.peer_id ===
          incoming.peer_id &&
        item.name,
    );

  const chats = snapshot.chats.map(
    (chat) => {
      if (
        chat.peer_id !==
        incoming.peer_id
      ) {
        return chat;
      }

      return {
        ...chat,
        known_addr: incoming.addr,
        online: true,
        title: hasContactAlias
          ? chat.title
          : incoming.name ||
            chat.title,
      };
    },
  );

  return {
    ...snapshot,
    neighbors,
    chats,
  };
}

export function upsertOnlineUser(
  snapshot: Snapshot,
  incoming: Snapshot["online_users"][number],
) {
  const onlineUsers = incoming.online
    ? snapshot.online_users
        .filter(
          (item) =>
            item.user_id !==
            incoming.user_id,
        )
        .concat(incoming)
        .sort(
          (a, b) =>
            b.last_seen -
            a.last_seen,
        )
    : snapshot.online_users.filter(
        (item) =>
          item.user_id !==
          incoming.user_id,
      );

  const chats = snapshot.chats.map(
    (chat) => {
      const peer =
        snapshot.neighbors.find(
          (item) =>
            item.peer_id ===
              chat.peer_id &&
            item.user_id ===
              incoming.user_id,
        );

      if (!peer) {
        return chat;
      }

      return {
        ...chat,
        online: incoming.online,
      };
    },
  );

  return {
    ...snapshot,
    online_users: onlineUsers,
    chats,
  };
}