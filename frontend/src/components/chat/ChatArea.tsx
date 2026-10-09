import type {
  ChatSummary,
  UIMessage,
} from "../../types";
import { useEffect, useRef, useState } from "react";
import { parseAttachment } from "../../files/attachment";
import { baseName } from "../../files/hidden";
import { sendLocalFiles, sendServerFiles, type ChatTarget } from "../../files/sendAttachment";
import { useTransfers } from "../../files/useTransfers";
import { onNativeFileDrop, pickLocalFiles } from "../../lib/desktop";
import FilesPickerDialog, { type PickedFile } from "../files/FilesPickerDialog";
import Attachment from "./Attachment";
import AttachMenu from "./AttachMenu";
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
  onNotify: (msg: string) => void;
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
  onNotify,
}: ChatAreaProps) {
  const firstMsgDate =
    selectedMessages.length > 0
      ? formatDate(
          selectedMessages[0].timestamp,
        )
      : "";
      const [picker, setPicker] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<string[] | null>(null);
  const [uploads, setUploads] = useState<{ id: string; label: string }[]>([]);
  const transfers = useTransfers();
  const rootRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef(selectedChat);
  chatRef.current = selectedChat;

  const canAttach = !!selectedChat?.peer_user_id && !selectedChat.blocked;

  function target(): ChatTarget | null {
    const c = chatRef.current;
    return c?.peer_user_id ? { chat_id: c.chat_id, peer_id: c.peer_id, peer_user_id: c.peer_user_id } : null;
  }

  async function sendLocal(paths: string[]) {
    const t = target();
    if (!t || paths.length === 0) return;
    let tid = "";
    const report = await sendLocalFiles(t, paths, (id, label) => {
      tid = id;
      setUploads((c) => [...c, { id, label }]);
    });
    if (tid) setUploads((c) => c.filter((u) => u.id !== tid));
    if (report.errors.length > 0) onNotify(`Не отправлено: ${report.errors.join("; ")}`);
  }

  async function sendFromFiles(items: PickedFile[]) {
    const t = target();
    if (!t) return;
    const report = await sendServerFiles(t, items);
    if (report.errors.length > 0) onNotify(`Не отправлено: ${report.errors.join("; ")}`);
  }

  async function pickAndSend(kind: "photo" | "file") {
    try {
      await sendLocal(await pickLocalFiles(kind));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Не удалось выбрать файлы");
    }
  }

  // Файлы с рабочего стола, брошенные на чат.
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    void onNativeFileDrop((e) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.phase === "leave") {
        setDropActive(false);
        return;
      }
      const r = el.getBoundingClientRect();
      const inside = e.x >= r.left && e.x <= r.right && e.y >= r.top && e.y <= r.bottom;
      const ok = inside && !!chatRef.current?.peer_user_id && !chatRef.current.blocked;
      if (e.phase === "drop") {
        setDropActive(false);
        if (ok) setPendingDrop(e.paths);
        return;
      }
      setDropActive(ok);
    }).then((u) => {
      if (dead) u();
      else off = u;
    });
    return () => {
      dead = true;
      off?.();
    };
  }, []);
  return (
    <div ref={rootRef} className={`main-chat main-chat-layout${dropActive ? " drop-active" : ""}`}>
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

                {selectedMessages.map((message) => {
                  const att = parseAttachment(message.text);
                  return (
                    <div
                      key={message.message_id ?? `${message.timestamp}-${message.from}`}
                      className={`msg-row ${message.direction}`}
                    >
                      <div className={`msg-content ${message.direction}`}>
                        <div
                          className={`msg-bubble ${message.direction}${att ? " has-attachment" : ""}${att?.kind === "photo" ? " media" : ""}`}
                        >
                          {att ? (
                            <Attachment att={att} outgoing={message.direction === "outgoing"} onNotify={onNotify} />
                          ) : (
                            <p className="msg-text">{message.text}</p>
                          )}

                          <div className="msg-meta">
                            <span className="msg-time">{formatTime(message.timestamp)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

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

                            {uploads.map((u) => {
                const t = transfers.find((x) => x.id === u.id);
                const pct = t && t.total > 0 ? Math.round((t.done / t.total) * 100) : null;
                return (
                  <div key={u.id} className="upload-strip">
                    Отправка: {u.label}
                    {pct !== null ? ` · ${pct}%` : "…"}
                  </div>
                );
              })}

              <div className="composer">
                <div className="composer-input-row">
                  <AttachMenu
                    disabled={!canAttach}
                    onPickPhoto={() => void pickAndSend("photo")}
                    onPickFile={() => void pickAndSend("file")}
                    onPickFromFiles={() => setPicker(true)}
                  />

                  <textarea
                    placeholder="Type a message or drop a file..."
                    value={composer}
                    onChange={(e) => onComposerChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                  />

                  <button className="send-btn" onClick={onSend} title="Send">
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
                {picker && selectedChat ? (
        <FilesPickerDialog
          onCancel={() => setPicker(false)}
          onPick={(items) => {
            setPicker(false);
            void sendFromFiles(items);
          }}
        />
      ) : null}

      {pendingDrop ? (
        <div className="fx-modal-backdrop">
          <div className="fx-modal fx-modal-small" role="dialog" aria-modal="true">
            <h3 className="fx-modal-title">Отправить в чат «{selectedChat?.title}»?</h3>
            <p className="fx-modal-text">
              {pendingDrop.slice(0, 5).map(baseName).join(", ")}
              {pendingDrop.length > 5 ? ` и ещё ${pendingDrop.length - 5}` : ""}
            </p>
            <div className="fx-modal-actions">
              <button type="button" className="fx-btn" onClick={() => setPendingDrop(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="fx-btn primary"
                onClick={() => {
                  const paths = pendingDrop;
                  setPendingDrop(null);
                  void sendLocal(paths);
                }}
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      ) : null}
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