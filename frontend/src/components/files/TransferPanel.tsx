import { formatBytes } from "../../files/format";
import type { TransferProgress } from "../../types";

interface Props {
  items: TransferProgress[];
  onCancel: (id: string) => void;
}

export function TransferPanel({ items, onCancel }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="fx-transfers">
      {items.map((t) => {
        const pct = t.total > 0 ? Math.min(100, (t.done / t.total) * 100) : null;
        const width = t.state === "done" ? "100%" : pct === null ? "40%" : `${pct}%`;
        return (
          <div key={t.id} className="fx-transfer">
            <div className="fx-transfer-row">
              <span className="fx-transfer-name" title={t.name}>
                {t.name}
              </span>
              {t.state === "running" && (
                <button type="button" className="fx-icon-btn" title="Отменить" onClick={() => onCancel(t.id)}>
                  ×
                </button>
              )}
            </div>
            <div className="fx-quota-bar">
              <div
                className={`fx-quota-fill${t.state === "error" ? " danger" : ""}${pct === null && t.state === "running" ? " indeterminate" : ""}`}
                style={{ width }}
              />
            </div>
            <div className="fx-transfer-meta">
              {t.state === "error"
                ? t.error || "Ошибка"
                : t.state === "done"
                  ? "Готово"
                  : `${formatBytes(t.done)}${t.total > 0 ? ` из ${formatBytes(t.total)}` : ""}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}