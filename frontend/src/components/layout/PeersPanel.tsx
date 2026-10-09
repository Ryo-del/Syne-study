import { attachmentPreview } from "../../files/attachment";
import {
  formatTime,
  joinAddress,
} from "../../lib/format";

import type {
  ChatSummary,
  Contact,
  Snapshot,
} from "../../types";

import type { SidebarView } from "../../config/settings";

interface PeersPanelProps {
  sidebarView: SidebarView;

  sidebarTitle: string;
  sidebarBadge: string;
  searchPlaceholder: string;

  query: string;
  onQueryChange: (
    value: string,
  ) => void;

  filteredChats: ChatSummary[];
  filteredNearbyPeers: Snapshot["neighbors"];
  filteredOnlineUsers: Snapshot["online_users"];
  filteredContacts: Contact[];
  filteredBlockedPeers: Snapshot["blocked"];

  selectedChatId: string;

  onSelectChat: (
    chatId: string,
  ) => void;

  onOpenPeer: (
    peerId: string,
    peerAddr?: string,
    name?: string,
  ) => void;

  onOpenContact: (
    contact: Contact,
  ) => void;

  onChatContextMenu: (
    event: React.MouseEvent,
    chatId: string,
  ) => void;

  onContactContextMenu: (
    event: React.MouseEvent,
    peerId: string,
  ) => void;

  getPeerAvatar: (
    peerId: string,
    label: string,
  ) => string;

  // query: user_id (логин) блокировки, а для старых записей peer_id
  onUnblock: (
    query: string,
  ) => void;

  onNewContact: () => void;
}

function onlineUserDisplayName(
  user: Snapshot["online_users"][number],
): string {
  const sname = user.sname?.trim() ?? "";
  const fname = user.fname?.trim() ?? "";

  const fullName = `${sname} ${fname}`.trim();

  return fullName || user.user_id;
}

export default function PeersPanel({
  sidebarView,
  sidebarTitle,
  sidebarBadge,
  searchPlaceholder,
  query,
  onQueryChange,
  filteredChats,
  filteredNearbyPeers,
  filteredOnlineUsers,
  filteredContacts,
  filteredBlockedPeers,
  selectedChatId,
  onSelectChat,
  onOpenPeer,
  onOpenContact,
  onChatContextMenu,
  onContactContextMenu,
  getPeerAvatar,
  onUnblock,
  onNewContact,
}: PeersPanelProps) {
  return (
    <aside className="peers-panel">
      <div className="peers-panel-header">
        <h2>{sidebarTitle}</h2>

        <span className="live-badge">
          {sidebarBadge}
        </span>
      </div>

      <div className="peers-panel-search">
        <input
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) =>
            onQueryChange(e.target.value)
          }
        />
      </div>

      <div className="peer-list">
        {sidebarView === "chats" ? (
          <>
            {filteredChats.map((chat) => (
              <div
                key={chat.chat_id}
                className="chat-list-row"
              >
                <button
                  className={`peer-card ${
                    chat.chat_id === selectedChatId
                      ? "active"
                      : ""
                  }`}
                  onContextMenu={(event) =>
                    onChatContextMenu(
                      event,
                      chat.chat_id,
                    )
                  }
                  onClick={() =>
                    onSelectChat(
                      chat.chat_id,
                    )
                  }
                >
                  <div
                    className={`peer-card-avatar ${
                      chat.blocked
                        ? "blocked"
                        : chat.online
                          ? "online"
                          : ""
                    }`}
                  >
                    {getPeerAvatar(
                      chat.peer_id,
                      chat.title ||
                        chat.peer_id,
                    )}
                  </div>

                  <div className="peer-card-info">
                    <div className="peer-card-info-top">
                      <strong>
                        {chat.title ||
                          chat.peer_id}
                      </strong>

                      <time>
                        {formatTime(
                          chat.last_timestamp,
                        )}
                      </time>
                    </div>

                    <div className="peer-card-info-bottom">
                      <span>
                        {attachmentPreview(chat.preview) ||
                          (chat.online
                            ? "Encrypted Stream"
                            : "Last seen: recently")}
                      </span>

                      {chat.unread_count > 0 ? (
                        <span className="unread-badge">
                          {
                            chat.unread_count
                          }
                        </span>
                      ) : chat.blocked ? (
                        <span className="live-tag blocked">
                          blocked
                        </span>
                      ) : chat.online ? (
                        <span className="live-tag">
                          live
                        </span>
                      ) : (
                        <span className="offline-tag">
                          offline
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            ))}

            {!filteredChats.length ? (
              <div className="empty-state compact">
                No chats yet.
              </div>
            ) : null}
          </>
        ) : null}

        {sidebarView === "network" ? (
          <>
            {filteredOnlineUsers.map(
              (user) => {
                const name =
                  onlineUserDisplayName(user);

                return (
                  <button
                    key={`user-${user.user_id}`}
                    className="peer-card"
                    disabled
                  >
                    <div className="peer-card-avatar online">
                      {getPeerAvatar(
                        user.user_id,
                        name,
                      )}
                    </div>

                    <div className="peer-card-info">
                      <div className="peer-card-info-top">
                        <strong>
                          {name}
                        </strong>
                      </div>

                      <div className="peer-card-info-bottom">
                        <span>
                          {user.user_id}
                        </span>

                        <span className="live-tag">
                          live
                        </span>
                      </div>
                    </div>
                  </button>
                );
              },
            )}

            {filteredNearbyPeers.map(
              (peer) => (
                <button
                  key={peer.peer_id}
                  className="peer-card"
                  onClick={() =>
                    onOpenPeer(
                      peer.peer_id,
                      peer.addr,
                      peer.name ||
                        peer.peer_id,
                    )
                  }
                >
                  <div
                    className={`peer-card-avatar ${
                      peer.blocked
                        ? "blocked"
                        : "online"
                    }`}
                  >
                    {getPeerAvatar(
                      peer.peer_id,
                      peer.name ||
                        peer.peer_id,
                    )}
                  </div>

                  <div className="peer-card-info">
                    <div className="peer-card-info-top">
                      <strong>
                        {peer.name ||
                          peer.peer_id}
                      </strong>
                    </div>

                    <div className="peer-card-info-bottom">
                      <span>
                        {peer.addr}
                      </span>

                      <span
                        className={`live-tag ${
                          peer.blocked
                            ? "blocked"
                            : ""
                        }`}
                      >
                        {peer.blocked
                          ? "blocked"
                          : "live"}
                      </span>
                    </div>
                  </div>
                </button>
              ),
            )}

            {!filteredOnlineUsers.length &&
            !filteredNearbyPeers.length ? (
              <div className="empty-state compact">
                No nearby peers.
              </div>
            ) : null}
          </>
        ) : null}

        {sidebarView === "contacts" ? (
          <>
            {filteredContacts.map(
              (contact) => (
                <div
                  // у контактов из каталога peer_id пустой — ключ по логину
                  key={
                    contact.user_id ||
                    contact.peer_id ||
                    contact.name
                  }
                  className="chat-list-row"
                >
                  <button
                    className="peer-card"
                    onContextMenu={(event) =>
                      onContactContextMenu(
                        event,
                        // удаление ищет и по логину, и по peer_id
                        contact.user_id ||
                          contact.peer_id,
                      )
                    }
                    onClick={() =>
                      onOpenContact(
                        contact,
                      )
                    }
                  >
                    <div className="peer-card-avatar">
                      {getPeerAvatar(
                        contact.peer_id,
                        contact.name ||
                          contact.peer_id,
                      )}
                    </div>

                    <div className="peer-card-info">
                      <div className="peer-card-info-top">
                        <strong>
                          {contact.name ||
                            contact.peer_id}
                        </strong>
                      </div>
                    </div>
                  </button>
                </div>
              ),
            )}

            {!filteredContacts.length ? (
              <div className="empty-state compact">
                No contacts yet.
              </div>
            ) : null}
          </>
        ) : null}

        {sidebarView === "blocked" ? (
          <>
            <div className="sidebar-blocked-list">
              {filteredBlockedPeers.map(
                (item) => {
                  const blockKey =
                    item.user_id ||
                    item.peer_id;
                  const reason =
                    item.reason?.trim();

                  return (
                    <div
                      key={blockKey}
                      className="blocked-item sidebar-blocked-item"
                    >
                      <div className="blocked-info">
                        <strong>
                          {item.name ||
                            item.user_id ||
                            item.peer_id ||
                            "Unknown"}
                        </strong>

                        {reason ? (
                          <span>
                            {reason}
                          </span>
                        ) : null}
                      </div>

                      <button
                        className="ghost-tiny"
                        onClick={() =>
                          onUnblock(
                            blockKey,
                          )
                        }
                      >
                        Unblock
                      </button>
                    </div>
                  );
                },
              )}
            </div>

            {!filteredBlockedPeers.length ? (
              <div className="empty-state compact">
                Black list is empty.
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {sidebarView === "chats" ||
      sidebarView === "contacts" ? (
        <div className="peers-panel-footer">
          <button
            type="button"
            className="new-contact-button"
            onClick={onNewContact}
          >
            + New contact
          </button>
        </div>
      ) : null}
    </aside>
  );
}