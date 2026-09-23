import { useMemo, useState } from "react";
import "./nearby.css";

export interface NearbyUser {
  user_id: string;
  peer_id: string;
  fname: string;
  sname: string;
  online: boolean;
  last_seen: number;
}

const EMOJI_PALETTE = [
  "🙂", "😎", "🐱", "🐶", "🦊", "🐼", "🐸", "🦁",
  "🍕", "🍩", "🚀", "⚡", "🔥", "🌟", "🎮", "🎧",
];

interface NearbyPanelProps {
  users: NearbyUser[];
  query: string;
  onQueryChange: (value: string) => void;
  getPeerAvatar: (peerId: string, label: string) => string;
  onSetPeerEmoji: (peerId: string, emoji: string) => void;
  onOpenPeer: (peerId: string, peerAddr?: string, name?: string) => void;
}

function displayName(user: NearbyUser) {
  const sname = user.sname.trim();
  const fname = user.fname.trim();
  const full = `${sname} ${fname}`.trim();
  return full || user.user_id;
}

export default function NearbyPanel({
  users,
  query,
  onQueryChange,
  getPeerAvatar,
  onSetPeerEmoji,
  onOpenPeer,
}: NearbyPanelProps) {
  const [emojiPickerPeerId, setEmojiPickerPeerId] = useState<string | null>(
    null,
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const list = needle
      ? users.filter(
          (user) =>
            displayName(user).toLowerCase().includes(needle) ||
            user.user_id.toLowerCase().includes(needle),
        )
      : users;

    return [...list].sort((a, b) =>
      displayName(a).localeCompare(displayName(b), "ru"),
    );
  }, [users, query]);

  return (
    <div className="nearby-panel">
      <div className="nearby-header">
        <div>
          <h2>Nearby</h2>
          <p>Кто сейчас в сети</p>
        </div>
        <span className="nearby-count">{filtered.length}</span>
      </div>

      <div className="nearby-search">
        <span>⌕</span>
        <input
          type="text"
          placeholder="Поиск..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      <div className="nearby-list">
        {filtered.map((user) => {
          const label = displayName(user);
          const avatar = getPeerAvatar(user.peer_id, label);
          const isPickerOpen = emojiPickerPeerId === user.peer_id;

          return (
            <div className="nearby-row" key={user.peer_id || user.user_id}>
              <button
                type="button"
                className="nearby-main"
                onClick={() =>
                  onOpenPeer(user.peer_id, undefined, label)
                }
              >
                <span
                  className="nearby-avatar"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmojiPickerPeerId(
                      isPickerOpen ? null : user.peer_id,
                    );
                  }}
                >
                  {avatar}
                </span>

                <span className="nearby-info">
                  <span className="nearby-name">{label}</span>
                  <span className="nearby-id">#{user.user_id}</span>
                </span>
              </button>

              <span className="nearby-online-dot" title="В сети" />

              {isPickerOpen ? (
                <div
                  className="nearby-emoji-picker"
                  onClick={(e) => e.stopPropagation()}
                >
                  {EMOJI_PALETTE.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="nearby-emoji-option"
                      onClick={() => {
                        onSetPeerEmoji(user.peer_id, emoji);
                        setEmojiPickerPeerId(null);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="nearby-empty">Никого нет в сети</div>
        )}
      </div>
    </div>
  );
}