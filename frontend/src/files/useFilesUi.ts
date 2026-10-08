import { useCallback, useEffect, useRef, useState } from "react";
import { filesApi } from "./api";
import { DEFAULT_UI, normalizeUi, type FilesUiState } from "./uiState";

/**
 * Загружает состояние интерфейса с сервера и сохраняет изменения (с задержкой 500 мс).
 * Неизвестные поля из сохранённого JSON переносятся как есть: их добавят следующие этапы.
 * Если загрузка не удалась, сохранение отключено, чтобы не затереть данные значениями по умолчанию.
 */
export function useFilesUi() {
  const [ui, setUi] = useState<FilesUiState>(DEFAULT_UI);
  const [ready, setReady] = useState(false);
  const uiRef = useRef<FilesUiState>(DEFAULT_UI);
  const rawRef = useRef<Record<string, unknown>>({});
  const canSave = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || !canSave.current) return;
    dirty.current = false;
    void filesApi.uiPut({ ...rawRef.current, ...uiRef.current }).catch(() => undefined);
  }, []);

  const update = useCallback(
    (fn: (s: FilesUiState) => FilesUiState) => {
      const next = fn(uiRef.current);
      if (next === uiRef.current) return;
      uiRef.current = next;
      setUi(next);
      dirty.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 500);
    },
    [flush],
  );

  useEffect(() => {
    let off = false;
    filesApi
      .uiGet<Record<string, unknown>>()
      .then((raw) => {
        if (off) return;
        if (raw && typeof raw === "object") {
          rawRef.current = raw;
          const n = normalizeUi(raw);
          uiRef.current = n;
          setUi(n);
        }
        canSave.current = true;
        setReady(true);
      })
      .catch(() => {
        if (off) return;
        canSave.current = false;
        setReady(true);
      });
    return () => {
      off = true;
      flush();
    };
  }, [flush]);

  return { ui, update, ready };
}