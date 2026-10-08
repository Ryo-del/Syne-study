import { useEffect, useMemo, useRef, useState } from "react";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { FILE_ACTIONS, type AclRule, type FileAction, type RuleMode } from "../../files/types";
import { searchDirectory } from "../../lib/api";
import type { DirectoryUser } from "../../types";

const LABELS: Record<FileAction, string> = {
  view: "Просмотр",
  download: "Скачивание",
  copy: "Копирование и дублирование",
  send: "Отправка",
  edit: "Редактирование",
  paste: "Вставка файлов и папок",
  delete: "Удаление",
};

const MODES: { id: RuleMode; label: string }[] = [
  { id: "all", label: "Разрешить всем" },
  { id: "contacts", label: "Разрешить только контактам" },
  { id: "selected", label: "Разрешить выделенным пользователям" },
  { id: "none", label: "Запретить всем" },
];

interface RuleState {
  mode: RuleMode;
  users: string[];
  inherited: boolean;
  dirty: boolean;
  clear: boolean; // вернуть наследование
}
type RuleMap = Record<FileAction, RuleState>;

function toMap(rules: AclRule[]): RuleMap {
  const out = {} as RuleMap;
  for (const a of FILE_ACTIONS) {
    const r = rules.find((x) => x.action === a);
    out[a] = r
      ? { mode: r.mode, users: r.users ?? [], inherited: r.inherited, dirty: false, clear: false }
      : { mode: "none", users: [], inherited: true, dirty: false, clear: false };
  }
  return out;
}

function userName(u: DirectoryUser) {
  return `${u.sname ?? ""} ${u.fname ?? ""}`.trim() || u.login;
}

function UserPicker({
  title,
  selected,
  onToggle,
  onDone,
}: {
  title: string;
  selected: string[];
  onToggle: (login: string) => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<DirectoryUser[]>([]);
  const [err, setErr] = useState("");
  const known = useRef(new Map<string, DirectoryUser>());

  useEffect(() => {
    const ac = new AbortController();
    const t = window.setTimeout(
      () => {
        searchDirectory(q, ac.signal)
          .then((r) => {
            r.forEach((u) => known.current.set(u.login, u));
            setList(r);
            setErr("");
          })
          .catch((e) => {
            if (!ac.signal.aborted) setErr(describeFileError(e));
          });
      },
      q ? 250 : 0,
    );
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [q]);

  const shown = useMemo(() => {
    if (q.trim()) return list;
    const inList = new Set(list.map((u) => u.login));
    const extra = selected
      .filter((l) => !inList.has(l))
      .map(
        (l) =>
          known.current.get(l) ?? ({ login: l, fname: "", sname: "", role: "", peer_id: "", online: false } as DirectoryUser),
      );
    return [...extra, ...list];
  }, [q, list, selected]);

  return (
    <>
      <h3 className="fx-modal-title">Пользователи: {title}</h3>
      <input
        className="fx-input"
        placeholder="Поиск по имени или логину"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="fx-picker-list">
        {err && <div className="fx-hint">{err}</div>}
        {shown.map((u) => (
          <label key={u.login} className="fx-picker-row">
            <input type="checkbox" checked={selected.includes(u.login)} onChange={() => onToggle(u.login)} />
            <span className="fx-picker-name">{userName(u)}</span>
            <span className="fx-picker-login">{u.login}</span>
          </label>
        ))}
        {!err && shown.length === 0 && <div className="fx-hint">Никого не найдено</div>}
      </div>
      <div className="fx-modal-actions">
        <span className="fx-modal-count">Выбрано: {selected.length}</span>
        <button type="button" className="fx-btn primary" onClick={onDone}>
          Готово
        </button>
      </div>
    </>
  );
}

interface Props {
  owner: string;
  path: string;
  name: string;
  isDir: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function PermissionsDialog({ owner, path, name, isDir, onClose, onSaved }: Props) {
  const actions = useMemo(() => (isDir ? FILE_ACTIONS : FILE_ACTIONS.filter((a) => a !== "paste")), [isDir]);
  const [state, setState] = useState<RuleMap | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<FileAction | null>(null);

  useEffect(() => {
    let off = false;
    filesApi
      .rulesGet(owner, path)
      .then((r) => {
        if (!off) setState(toMap(r));
      })
      .catch((e) => {
        if (!off) setError(describeFileError(e));
      });
    return () => {
      off = true;
    };
  }, [owner, path]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        if (picker) setPicker(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, picker, saving]);

  function patch(a: FileAction, fn: (r: RuleState) => RuleState) {
    setState((s) => (s ? { ...s, [a]: fn(s[a]) } : s));
  }

  function setMode(a: FileAction, mode: RuleMode) {
    patch(a, (r) => ({
      ...r,
      mode,
      users: mode === "selected" ? r.users : [],
      inherited: false,
      dirty: true,
      clear: false,
    }));
  }

  function toggleUser(a: FileAction, login: string) {
    patch(a, (r) => ({
      ...r,
      users: r.users.includes(login) ? r.users.filter((x) => x !== login) : [...r.users, login],
      inherited: false,
      dirty: true,
      clear: false,
    }));
  }

  async function save() {
    if (!state) return;
    setSaving(true);
    setError("");
    try {
      for (const a of actions) {
        const r = state[a];
        if (!r.dirty) continue;
        if (r.clear) await filesApi.ruleClear(owner, path, a);
        else await filesApi.ruleSet(owner, path, a, r.mode, r.users);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(describeFileError(err));
      try {
        setState(toMap(await filesApi.rulesGet(owner, path)));
      } catch {
        // оставляем то, что на экране
      }
      setSaving(false);
    }
  }

  const dirty = state ? actions.some((a) => state[a].dirty) : false;

  return (
    <div className="fx-modal-backdrop">
      <div className="fx-modal" role="dialog" aria-modal="true">
        {picker && state ? (
          <UserPicker
            title={LABELS[picker]}
            selected={state[picker].users}
            onToggle={(l) => toggleUser(picker, l)}
            onDone={() => setPicker(null)}
          />
        ) : (
          <>
            <h3 className="fx-modal-title">Права: {name}</h3>
            {!state && !error && <div className="fx-hint">Загрузка…</div>}
            {state && (
              <table className="fx-perm">
                <thead>
                  <tr>
                    <th />
                    {MODES.map((m) => (
                      <th key={m.id}>{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => {
                    const r = state[a];
                    return (
                      <tr key={a}>
                        <td className="fx-perm-name">
                          <div>{LABELS[a]}</div>
                          <div className="fx-perm-sub">
                            {r.clear || r.inherited ? (
                              <span>{r.clear ? "будет наследоваться" : "наследуется"}</span>
                            ) : (
                              <button type="button" className="fx-link" onClick={() => patch(a, (x) => ({ ...x, dirty: true, clear: true }))}>
                                Наследовать
                              </button>
                            )}
                            {r.mode === "selected" && !r.clear && (
                              <button type="button" className="fx-link" onClick={() => setPicker(a)}>
                                Пользователи ({r.users.length})
                              </button>
                            )}
                          </div>
                        </td>
                        {MODES.map((m) => (
                          <td key={m.id} className="fx-perm-cell">
                            <input
                              type="radio"
                              name={`perm-${a}`}
                              checked={!r.clear && r.mode === m.id}
                              onChange={() => {
                                setMode(a, m.id);
                                if (m.id === "selected") setPicker(a);
                              }}
                              aria-label={`${LABELS[a]}: ${m.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {error && <div className="fx-modal-error">{error}</div>}
            <div className="fx-modal-actions">
              <button type="button" className="fx-btn" onClick={onClose} disabled={saving}>
                Отмена
              </button>
              <button type="button" className="fx-btn primary" onClick={() => void save()} disabled={!state || !dirty || saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}