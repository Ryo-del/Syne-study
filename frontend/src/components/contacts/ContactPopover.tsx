import { useEffect, useState } from "react";
import { searchDirectory } from "../../lib/api";
import { describeError } from "../../lib/format";
import type { Contact, DirectoryUser } from "../../types";

interface ContactPopoverProps {
  contacts: Contact[];
  saving: boolean;
  getPeerAvatar: (peerId: string, label: string) => string;
  onAdd: (user: DirectoryUser) => void;
  onClose: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;

function fullName(u: DirectoryUser) {
  return `${u.fname} ${u.sname}`.trim() || u.login;
}


export default function ContactPopover({
  contacts,
  saving,
  getPeerAvatar,
  onAdd,
  onClose,
}: ContactPopoverProps) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          const items = await searchDirectory(query, controller.signal);
          if (!controller.signal.aborted) setUsers(items);
        } catch (err) {
          if (!controller.signal.aborted) {
            setError(describeError(err, "Failed to load users"));
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const isAdded = (u: DirectoryUser) =>
  contacts.some((c) =>
    c.user_id ? c.user_id === u.login : !!u.peer_id && c.peer_id === u.peer_id,
  );

  return (
    <>
      <div className="contact-popover-backdrop" onClick={onClose} />

      <div className="contact-popover">
        <div className="popover-head">
          <h2>New contact</h2>
          <button type="button" className="ghost-tiny" onClick={onClose}>
            Close
          </button>
        </div>

        <input
          className="directory-search"
          value={query}
          placeholder="Search by name..."
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="directory-list">
          {error ? <div className="directory-empty">{error}</div> : null}

          {!error && !loading && users.length === 0 ? (
            <div className="directory-empty">No users found</div>
          ) : null}

          {!error &&
            users.map((u) => {
              const name = fullName(u);
              return (
                <div className="directory-row" key={u.login}>
                  <div className="directory-avatar">
                    {getPeerAvatar(u.peer_id || u.login, name)}
                    {u.online ? <span className="directory-online" /> : null}
                  </div>

                  <div className="directory-name">{name}</div>

                  {isAdded(u) ? (
                    <span className="directory-added" title="Already in ">
                      ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="directory-add"
                      title="Add contact"
                      aria-label={`Add ${name}`}
                      disabled={saving}
                      onClick={() => onAdd(u)}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}