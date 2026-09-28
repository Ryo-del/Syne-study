import EmojiPicker from "../common/EmojiPicker";

import type {
  ChatSummary,
  Contact,
} from "../../types";

interface DetailPanelProps {
  selectedChat: ChatSummary;
  selectedContact: Contact | null;

  selectedPeerEmoji: string;
  selectedAddr: string;

  emojiPickerTarget:
    | "self"
    | "peer"
    | null;

  editingPeerName: boolean;
  peerNameDraft: string;
  blockReason: string;

  saving: boolean;

  onEmojiTargetChange: (
    target: "self" | "peer" | null,
  ) => void;

  onPeerEmojiChange: (
    emoji: string,
  ) => void;

  onPeerNameEditing: (
    value: boolean,
  ) => void;

  onPeerNameDraftChange: (
    value: string,
  ) => void;

  onCommitPeerName: () => void;

  onBlockReasonChange: (
    value: string,
  ) => void;

  onBlock: () => void;
}

export default function DetailPanel({
  selectedChat,
  selectedContact,
  selectedPeerEmoji,
  selectedAddr,
  emojiPickerTarget,
  editingPeerName,
  peerNameDraft,
  blockReason,
  saving,
  onEmojiTargetChange,
  onPeerEmojiChange,
  onPeerNameEditing,
  onPeerNameDraftChange,
  onCommitPeerName,
  onBlockReasonChange,
  onBlock,
}: DetailPanelProps) {
  return (
    <aside className="detail-panel">
      <div className="detail-banner" />

      <div className="detail-hero">
        <div className="emoji-anchor">
          <button
            type="button"
            className="detail-avatar"
            onClick={() =>
              onEmojiTargetChange(
                emojiPickerTarget === "peer"
                  ? null
                  : "peer",
              )
            }
          >
            {selectedPeerEmoji}

            <div
              className={`status-indicator ${
                selectedChat.blocked
                  ? "blocked"
                  : selectedChat.online
                    ? "online"
                    : ""
              }`}
            />
          </button>

          {emojiPickerTarget === "peer" ? (
            <EmojiPicker
              onSelect={onPeerEmojiChange}
            />
          ) : null}
        </div>

        <div className="detail-name-block">
          {editingPeerName ? (
            <input
              className="inline-name-input"
              value={peerNameDraft}
              autoFocus
              onChange={(e) =>
                onPeerNameDraftChange(
                  e.target.value,
                )
              }
              onBlur={() =>
                void onCommitPeerName()
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onCommitPeerName();
                }

                if (e.key === "Escape") {
                  onPeerNameEditing(false);

                  onPeerNameDraftChange(
                    selectedContact?.name ??
                      selectedChat.title,
                  );
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="editable-name"
              onClick={() =>
                onPeerNameEditing(true)
              }
            >
              {selectedChat.title}
            </button>
          )}

          <p className="peer-id-subtextline">
            @
            ...
          </p>
        </div>
      </div>

      <div className="detail-content">
        <div className="detail-divider" />

        

        {selectedAddr && (
          <div className="info-section">
            <span className="section-label">
              ADDRESS
            </span>

            <div
              className="id-copy-box"
              onClick={() =>
                navigator.clipboard.writeText(
                  selectedAddr,
                )
              }
            >
              <code>
                {selectedAddr}
              </code>
            </div>
          </div>
        )}
      </div>

      <div className="detail-footer">
        <div className="inline-block-form">
          <input
            placeholder="Reason..."
            value={blockReason}
            onChange={(e) =>
              onBlockReasonChange(
                e.target.value,
              )
            }
          />

          <button
            className="danger-btn"
            onClick={onBlock}
            disabled={saving}
          >
            Block
          </button>
        </div>
      </div>
    </aside>
  );
}