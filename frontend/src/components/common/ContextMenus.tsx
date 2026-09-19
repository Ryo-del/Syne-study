interface ChatContextMenuState {
  chatId: string;
  x: number;
  y: number;
}

interface ContactContextMenuState {
  peerId: string;
  x: number;
  y: number;
}

interface ContextMenusProps {
  chatContextMenu:
    | ChatContextMenuState
    | null;

  contactContextMenu:
    | ContactContextMenuState
    | null;

  onHideChat: (chatId: string) => void;
  onDeleteContact: (
    peerId: string,
  ) => void;
}

export default function ContextMenus({
  chatContextMenu,
  contactContextMenu,
  onHideChat,
  onDeleteContact,
}: ContextMenusProps) {
  return (
    <>
      {chatContextMenu ? (
        <div
          className="chat-context-menu"
          style={{
            top: Math.max(
              16,
              chatContextMenu.y,
            ),
            left: Math.max(
              16,
              chatContextMenu.x,
            ),
          }}
          onPointerDown={(event) =>
            event.stopPropagation()
          }
        >
          <button
            type="button"
            className="chat-context-menu-item danger"
            onClick={() =>
              onHideChat(
                chatContextMenu.chatId,
              )
            }
          >
            Удалить чат 🗑️
          </button>
        </div>
      ) : null}

      {contactContextMenu ? (
        <div
          className="chat-context-menu"
          style={{
            top: Math.max(
              16,
              contactContextMenu.y,
            ),
            left: Math.max(
              16,
              contactContextMenu.x,
            ),
          }}
          onPointerDown={(event) =>
            event.stopPropagation()
          }
        >
          <button
            type="button"
            className="chat-context-menu-item danger"
            onClick={() =>
              onDeleteContact(
                contactContextMenu.peerId,
              )
            }
          >
            Удалить контакт 🗑️
          </button>
        </div>
      ) : null}
    </>
  );
}