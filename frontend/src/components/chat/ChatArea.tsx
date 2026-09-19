import type {
  ChatSummary,
  UIMessage,
} from "../../types";

import { formatDate, formatTime } from "../../lib/format";

import DetailPanel from "./DetailPanel";

interface ChatAreaProps {
  selectedChat: ChatSummary | null;
  selectedContact: any;
  
  selectedPeerEmoji: string;
  selectedAddr: string;
  selectedMessages: UIMessage[];

  loading: boolean;
  apiBase: string;

  showDetailPanel: boolean;
  setShowDetailPanel: (
    value: boolean,
  ) => void;

  emojiPickerTarget:
    | "self"
    | "peer"
    | null;

  editingPeerName: boolean;
  peerNameDraft: string;
  blockReason: string;
  saving: boolean;

  composer: string;
  
  messageStreamRef: React.RefObject<HTMLDivElement>;

  onAddContact: () => void;

  onComposerChange: (
    value: string,
  ) => void;

  onSend: () => void;

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

export default function ChatArea({
  selectedChat,
  selectedContact,
  selectedPeerEmoji,
  selectedAddr,
  selectedMessages,
  loading,
  apiBase,
  showDetailPanel,
  setShowDetailPanel,
  emojiPickerTarget,
  editingPeerName,
  peerNameDraft,
  blockReason,
  saving,
  composer,
  messageStreamRef,
  onAddContact,
  onComposerChange,
  onSend,
  onEmojiTargetChange,
  onPeerEmojiChange,
  onPeerNameEditing,
  onPeerNameDraftChange,
  onCommitPeerName,
  onBlockReasonChange,
  onBlock,
}: ChatAreaProps) {
  const firstMsgDate =
    selectedMessages.length > 0
      ? formatDate(
          selectedMessages[0].timestamp,
        )
      : "";

  return (
    <div className="main-chat main-chat-layout">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div className="chat-header">
          <div className="chat-header-left">
            <div className="chat-header-title">
              {selectedChat ? (
                <button
                  type="button"
                  className="chat-header-name"
                  onClick={() =>
                    setShowDetailPanel(
                      !showDetailPanel,
                    )
                  }
                >
                  {selectedChat.title}
                </button>
              ) : (
                <h2>
                  Select a chat
                </h2>
              )}

              {selectedChat ? (
                <div
                  className={
                    selectedChat.blocked
                      ? "blocked-dot"
                      : selectedChat.online
                        ? "online-dot"
                        : "offline-dot"
                  }
                />
              ) : null}
            </div>
          </div>

          <div className="chat-header-right">
            {selectedChat ? (
              <>
                {!selectedContact && (
                  <button
                    className="header-btn"
                    onClick={onAddContact}
                  >
                    + Add Contact
                  </button>
                )}

                <button
                  className="kebab-btn"
                  onClick={() =>
                    setShowDetailPanel(
                      !showDetailPanel,
                    )
                  }
                  title="Toggle peer details"
                >
                  ⋮
                </button>
              </>
            ) : null}
          </div>
        </div>

        <section
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {loading ? (
            <div className="empty-state">
              <div>
                <h3>
                  Connecting to backend
                </h3>

                <p>
                  The Tauri shell expects the Go
                  bridge at {apiBase}.
                </p>
              </div>
            </div>
          ) : selectedChat ? (
            <>
              <div
                ref={messageStreamRef}
                className="message-stream"
              >
                {firstMsgDate && (
                  <div className="session-separator">
                    <span>
                      {firstMsgDate}
                    </span>
                  </div>
                )}

                {selectedMessages.map(
                  (message) => (
                    <div
                      key={
                        message.message_id ??
                        `${message.timestamp}-${message.from}`
                      }
                      className={`msg-row ${message.direction}`}
                    >
                      <div
                        className={`msg-content ${message.direction}`}
                      >
                        <div
                          className={`msg-bubble ${message.direction}`}
                        >
                          <p className="msg-text">
                            {message.text}
                          </p>

                          <div className="msg-meta">
                            <span className="msg-time">
                              {formatTime(
                                message.timestamp,
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ),
                )}

                {!selectedMessages.length ? (
                  <div className="empty-state">
                    <div>
                      <h3>
                        Chat is open
                      </h3>

                      <p>
                        Handshake is ready.
                        Send the first message.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="composer">
                <div className="composer-input-row">
                  <textarea
                    placeholder="Type a message or drop a file..."
                    value={composer}
                    onChange={(e) =>
                      onComposerChange(
                        e.target.value,
                      )
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey
                      ) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                  />

                  <button
                    className="send-btn"
                    onClick={onSend}
                    title="Send"
                  >
                    ➤
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div>
                <h3>
                  No active conversation
                </h3>

                <p>
                  Pick a chat or open a nearby
                  peer from the panel.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {selectedChat &&
      showDetailPanel ? (
        <DetailPanel
          selectedChat={selectedChat}
          selectedContact={
            selectedContact
          }
          selectedPeerEmoji={
            selectedPeerEmoji
          }
          selectedAddr={selectedAddr}
          emojiPickerTarget={
            emojiPickerTarget
          }
          editingPeerName={
            editingPeerName
          }
          peerNameDraft={
            peerNameDraft
          }
          blockReason={
            blockReason
          }
          saving={saving}
          onEmojiTargetChange={
            onEmojiTargetChange
          }
          onPeerEmojiChange={
            onPeerEmojiChange
          }
          onPeerNameEditing={
            onPeerNameEditing
          }
          onPeerNameDraftChange={
            onPeerNameDraftChange
          }
          onCommitPeerName={
            onCommitPeerName
          }
          onBlockReasonChange={
            onBlockReasonChange
          }
          onBlock={onBlock}
        />
      ) : null}
    </div>
  );
}