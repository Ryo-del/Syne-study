import type {
  Contact,
  InviteCode,
} from "../../types";

interface ContactPopoverProps {
  contactForm: Contact;
  inviteCode: InviteCode | null;
  invitePeerIdDraft: string;
  saving: boolean;
  selectedChat: unknown;

  onClose: () => void;

  onInvitePeerIdChange: (
    value: string,
  ) => void;

  onContactFormChange: (
    value: Contact,
  ) => void;

  onOpenInvitePeer: () => void;

  onPrefillCurrentPeer: () => void;

  onSaveContact: () => void;
}

export default function ContactPopover({
  contactForm,
  inviteCode,
  invitePeerIdDraft,
  saving,
  selectedChat,
  onClose,
  onInvitePeerIdChange,
  onContactFormChange,
  onOpenInvitePeer,
  onPrefillCurrentPeer,
  onSaveContact,
}: ContactPopoverProps) {
  return (
    <>
      <div
        className="contact-popover-backdrop"
        onClick={onClose}
      />

      <div className="contact-popover">
        <div className="popover-head">
          <h2>Add friend</h2>

          <button
            type="button"
            className="ghost-tiny"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="popover-form">
          <label>
            <span>
              Your 6-digit code
            </span>

            <input
              value={
                inviteCode?.code ??
                "Loading..."
              }
              readOnly
            />
          </label>

          <label>
            <span>
              Friend code
            </span>

            <input
              value={
                invitePeerIdDraft
              }
              placeholder="123456"
              onChange={(e) =>
                onInvitePeerIdChange(
                  e.target.value
                    .replace(/\D/g, "")
                    .slice(0, 6),
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onOpenInvitePeer();
                }
              }}
            />
          </label>
        </div>

        <div className="popover-form">
          <label>
            <span>
              Display Name
            </span>

            <input
              value={
                contactForm.name
              }
              onChange={(e) =>
                onContactFormChange({
                  ...contactForm,
                  name: e.target.value,
                })
              }
            />
          </label>

          <label>
            <span>IP</span>

            <input
              value={
                contactForm.ip
              }
              onChange={(e) =>
                onContactFormChange({
                  ...contactForm,
                  ip: e.target.value,
                })
              }
            />
          </label>

          <label>
            <span>
              Peer ID
            </span>

            <input
              value={
                contactForm.peer_id
              }
              onChange={(e) =>
                onContactFormChange({
                  ...contactForm,
                  peer_id:
                    e.target.value,
                })
              }
            />
          </label>

          <label>
            <span>
              Port
            </span>

            <input
              value={
                contactForm.port
              }
              onChange={(e) =>
                onContactFormChange({
                  ...contactForm,
                  port: e.target.value,
                })
              }
            />
          </label>
        </div>

        <div className="action-row">
          <button
            className="ghost"
            disabled={
              !invitePeerIdDraft ||
              saving
            }
            onClick={
              onOpenInvitePeer
            }
          >
            Open by code
          </button>

          <button
            className="ghost"
            disabled={!selectedChat}
            onClick={
              onPrefillCurrentPeer
            }
          >
            Use current peer
          </button>

          <button
            className="primary"
            disabled={saving}
            onClick={onSaveContact}
          >
            Save contact
          </button>
        </div>
      </div>
    </>
  );
}