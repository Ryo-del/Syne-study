import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MIN_EXPLORER_WIDTH } from "../../files/uiState";
import { useFilesUi } from "../../files/useFilesUi";
import { Explorer } from "./Explorer";
import "./files.css";

export function Files() {
  const { ui, update, ready } = useFilesUi();
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  function startResize(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const clamp = (clientX: number) =>
      Math.max(MIN_EXPLORER_WIDTH, Math.min(clientX - rect.left, rect.width));

    const move = (ev: PointerEvent) => setDragWidth(clamp(ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const w = clamp(ev.clientX);
      setDragWidth(null);
      // Почти до правого края значит снова «explorer на всё окно».
      update((s) => ({ ...s, explorerWidth: w >= rect.width - 8 ? null : Math.round(w) }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  if (!ready) {
    return (
      <div className="fx-root">
        <div className="fx-loading">Загрузка…</div>
      </div>
    );
  }

  const width = dragWidth ?? ui.explorerWidth;
  const full = width === null;

  return (
    <div ref={rootRef} className={`fx-root${dragWidth !== null ? " resizing" : ""}`}>
      <div
        className={`fx-explorer ${full ? "full" : "sized"}`}
        style={full ? undefined : { width }}
      >
        <Explorer ui={ui} update={update} />
        <div
          className="fx-splitter"
          onPointerDown={startResize}
          onDoubleClick={() => update((s) => ({ ...s, explorerWidth: null }))}
          title="Потяните, чтобы освободить место справа"
        />
      </div>
      {!full && (
        <div className="fx-empty-space">
          <span>Пустое место</span>
        </div>
      )}
    </div>
  );
}