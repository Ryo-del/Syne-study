import { useReducer } from "react";

export interface Doc {
  key: string;
  /** Как ждёт API: "" — своя папка. */
  owner: string;
  path: string;
  name: string;
  /** Исходный текст, из него создаётся модель Monaco. */
  text: string;
  /** mod_time версии, с которой начали правку (для проверки конфликта). */
  baseModTime: number;
  dirty: boolean;
  readOnly: boolean;
  /** Доступ закрыт уже после открытия: файл виден, сохранить нельзя. */
  locked: boolean;
}

export interface EditorState {
  docs: Doc[];
  active: string | null;
}

type State = Record<string, EditorState>;

type Action =
  | { t: "open"; pane: string; doc: Doc }
  | { t: "activate"; pane: string; key: string }
  | { t: "close"; pane: string; key: string }
  | { t: "drop"; pane: string }
  | { t: "patch"; pane: string; key: string; patch: Partial<Doc> };

export function docKey(owner: string, path: string) {
  return `${owner}\u0000${path}`;
}

const EMPTY: EditorState = { docs: [], active: null };

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "open": {
      const cur = s[a.pane] ?? EMPTY;
      const exists = cur.docs.some((d) => d.key === a.doc.key);
      return { ...s, [a.pane]: { docs: exists ? cur.docs : [...cur.docs, a.doc], active: a.doc.key } };
    }
    case "activate": {
      const cur = s[a.pane];
      return cur && cur.docs.some((d) => d.key === a.key) ? { ...s, [a.pane]: { ...cur, active: a.key } } : s;
    }
    case "close": {
      const cur = s[a.pane];
      if (!cur) return s;
      const i = cur.docs.findIndex((d) => d.key === a.key);
      if (i < 0) return s;
      const docs = cur.docs.filter((d) => d.key !== a.key);
      const active = cur.active !== a.key ? cur.active : docs[Math.min(i, docs.length - 1)]?.key ?? null;
      return { ...s, [a.pane]: { docs, active } };
    }
    case "drop": {
      const { [a.pane]: _removed, ...rest } = s;
      return rest;
    }
    case "patch": {
      const cur = s[a.pane];
      if (!cur) return s;
      return { ...s, [a.pane]: { ...cur, docs: cur.docs.map((d) => (d.key === a.key ? { ...d, ...a.patch } : d)) } };
    }
    default:
      return s;
  }
}

export function useEditors() {
  const [state, dispatch] = useReducer(reducer, {} as State);
  return { state, dispatch };
}