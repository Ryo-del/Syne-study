import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { filesApi } from "../../files/api";
import { describeFileError } from "../../files/errors";
import { iconUrl } from "../../files/icons";
import { monaco } from "../../files/monaco";
import type { Doc, EditorState } from "../../files/useEditors";
import { ApiError } from "../../lib/api";
import { useFilesCtx } from "./FilesContext";

interface ModelEntry {
  model: monaco.editor.ITextModel;
  /** Версия модели на момент последнего сохранения. Равенство версий значит «нет несохранённого». */
  savedVersion: number;
}

interface Props {
paneId: string;
  state: EditorState;
  focused: boolean;
  onFocus: () => void;
  onActivate: (key: string) => void;
  onCloseTab: (key: string) => void;
  onPatch: (key: string, patch: Partial<Doc>) => void;
  registerSaver: (paneId: string, fn: ((key: string) => Promise<boolean>) | null) => void;
}

export function EditorPane({ paneId, state, focused, onFocus, onActivate, onCloseTab, onPatch, registerSaver }: Props) {
  const ctx = useFilesCtx();
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, ModelEntry>());
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const shownKey = useRef<string | null>(null);
  const saving = useRef(new Set<string>());

  // Свежие значения для обработчиков, которые Monaco хранит надолго.
  const latest = useRef({ state, focused, onFocus, onPatch, ctx, registerSaver });
  latest.current = { state, focused, onFocus, onPatch, ctx, registerSaver };

  async function writeDoc(doc: Doc, entry: ModelEntry, base: number, retried: boolean): Promise<boolean> {
    const { onPatch: patch, ctx: c } = latest.current;
    const version = entry.model.getAlternativeVersionId();
    try {
      const saved = await filesApi.writeText(doc.owner, doc.path, entry.model.getValue(), base);
      const stat = saved ?? (await filesApi.stat(doc.owner, doc.path));
      entry.savedVersion = version;
      patch(doc.key, {
        baseModTime: stat?.mod_time ?? base,
        dirty: entry.model.getAlternativeVersionId() !== version,
      });
      c.notify("Сохранено", "info");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") {
        if (retried) {
          c.notify("Файл снова изменён другим пользователем. Повторите сохранение.");
          return false;
        }
        const choice = await c.askChoice({
          title: "Файл изменён другим пользователем",
          text: `Пока вы правили «${doc.name}», файл на сервере изменился. Что сделать?`,
          buttons: [
            { id: "overwrite", label: "Перезаписать", kind: "danger" },
            { id: "reload", label: "Загрузить версию с сервера" },
            { id: "cancel", label: "Отмена" },
          ],
        });
        if (choice === "overwrite") {
          let st;
          try {
            st = await filesApi.stat(doc.owner, doc.path);
          } catch (e2) {
            c.notify(describeFileError(e2));
            return false;
          }
          if (!st) {
            c.notify("Файл не найден");
            return false;
          }
          return writeDoc(doc, entry, st.mod_time, true);
        }
        if (choice === "reload") {
          try {
            const r = await filesApi.readText(doc.owner, doc.path);
            entry.model.setValue(r.text);
            entry.savedVersion = entry.model.getAlternativeVersionId();
            patch(doc.key, { baseModTime: r.entry.mod_time, dirty: false });
          } catch (e3) {
            c.notify(describeFileError(e3));
          }
        }
        return false;
      }
      if (err instanceof ApiError && err.code === "forbidden") {
        patch(doc.key, { locked: true });
        c.notify("Доступ закрыт: сохранить нельзя");
        return false;
      }
      c.notify(describeFileError(err));
      return false;
    }
  }

  async function saveDoc(key: string): Promise<boolean> {
    const { state: st, ctx: c } = latest.current;
    const doc = st.docs.find((d) => d.key === key);
    const entry = models.current.get(key);
    if (!doc || !entry) return false;
    if (entry.model.getAlternativeVersionId() === entry.savedVersion) return true; // нечего сохранять
    if (doc.locked) {
      c.notify("Доступ закрыт: сохранить нельзя");
      return false;
    }
    if (doc.readOnly) {
      c.notify("Нет права на редактирование");
      return false;
    }
    if (saving.current.has(key)) return false;
    saving.current.add(key);
    try {
      return await writeDoc(doc, entry, doc.baseModTime, false);
    } finally {
      saving.current.delete(key);
    }
  }

  // Создание и удаление редактора.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      model: null,
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: "on",
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
      padding: { top: 8, bottom: 8 },
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const k = latest.current.state.active;
      if (k) void saveDoc(k);
    });
    const focusSub = editor.onDidFocusEditorWidget(() => latest.current.onFocus());
    latest.current.registerSaver(paneId, saveDoc);

    return () => {
      focusSub.dispose();
      latest.current.registerSaver(paneId, null);
      editor.dispose();
      editorRef.current = null;
      models.current.forEach((m) => m.model.dispose());
      models.current.clear();
      views.current.clear();
      shownKey.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Синхронизация моделей с вкладками и показ активной.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    for (const doc of state.docs) {
      if (models.current.has(doc.key)) continue;
      const model = monaco.editor.createModel(doc.text, "plaintext");
      const entry: ModelEntry = { model, savedVersion: model.getAlternativeVersionId() };
      model.onDidChangeContent(() => {
        const dirty = model.getAlternativeVersionId() !== entry.savedVersion;
        const cur = latest.current.state.docs.find((d) => d.key === doc.key);
        if (cur && cur.dirty !== dirty) latest.current.onPatch(doc.key, { dirty });
      });
      models.current.set(doc.key, entry);
    }

    const active = state.active && models.current.has(state.active) ? state.active : null;
    if (shownKey.current !== active) {
      if (shownKey.current) views.current.set(shownKey.current, editor.saveViewState());
      shownKey.current = active;
      editor.setModel(active ? models.current.get(active)!.model : null);
      if (active) {
        const vs = views.current.get(active);
        if (vs) editor.restoreViewState(vs);
        if (latest.current.focused) editor.focus();
      }
    }

    const keys = new Set(state.docs.map((d) => d.key));
    for (const [key, m] of Array.from(models.current)) {
      if (keys.has(key)) continue;
      m.model.dispose();
      models.current.delete(key);
      views.current.delete(key);
    }

    const doc = state.docs.find((d) => d.key === active);
    editor.updateOptions({ readOnly: !!doc && (doc.readOnly || doc.locked) });
  }, [state.docs, state.active]);

  function windowMenu(e: ReactMouseEvent) {
    e.preventDefault();
    ctx.openMenu(e.clientX, e.clientY, [
      { label: "Новое окно", onClick: () => ctx.newWindow() },
      { label: "Закрыть окно", onClick: () => ctx.closePane(paneId) },
    ]);
  }

  const activeDoc = state.docs.find((d) => d.key === state.active);

  return (
    <div className={`fx-editor${focused ? " focused" : ""}`} onMouseDownCapture={onFocus}>
      <div className="fx-tabs" onContextMenu={windowMenu}>
        <div className="fx-tabs-list">
          {state.docs.map((d) => (
            <div
              key={d.key}
              className={`fx-tab${d.key === state.active ? " active" : ""}`}
              title={d.path}
              onClick={() => onActivate(d.key)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(d.key);
                }
              }}
            >
              <img className="fx-icon" src={iconUrl(d.name, false)} alt="" draggable={false} />
              <span className="fx-tab-name">{d.name}</span>
              <button
                type="button"
                className={`fx-tab-close${d.dirty ? " dirty" : ""}`}
                aria-label="Закрыть"
                title={d.dirty ? "Есть несохранённые изменения" : "Закрыть"}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(d.key);
                }}
              >
                {d.dirty && <span className="fx-dot" />}
                <span className="fx-x">×</span>
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="fx-icon-btn" title="Закрыть окно" onClick={() => ctx.closePane(paneId)}>
          ×
        </button>
      </div>

      {activeDoc?.locked ? (
        <div className="fx-banner">Доступ закрыт: файл доступен только для просмотра, сохранение отключено</div>
      ) : activeDoc?.readOnly ? (
        <div className="fx-banner">Только просмотр: нет права на редактирование</div>
      ) : null}

      <div ref={hostRef} className="fx-monaco" style={{ display: state.docs.length > 0 ? undefined : "none" }} />
      {state.docs.length === 0 && (
        <div className="fx-editor-empty" onContextMenu={windowMenu}>
          Откройте .txt файл двойным кликом
        </div>
      )}
    </div>
  );
}