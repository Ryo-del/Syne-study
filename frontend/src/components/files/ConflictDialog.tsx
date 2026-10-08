import { useEffect } from "react";
import type { ConflictPolicy } from "../../files/types";

interface Props {
  name: string;
  onChoose: (p: ConflictPolicy | null) => void;
}

export function ConflictDialog({ name, onChoose }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onChoose(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onChoose]);

  return (
    <div className="fx-modal-backdrop">
      <div className="fx-modal fx-modal-small" role="dialog" aria-modal="true">
        <h3 className="fx-modal-title">«{name}» уже существует</h3>
        <p className="fx-modal-text">Выбор применится ко всем остальным совпадениям в этой операции.</p>
        <div className="fx-modal-actions">
          <button type="button" className="fx-btn" onClick={() => onChoose(null)}>
            Отмена
          </button>
          <button type="button" className="fx-btn" onClick={() => onChoose("skip")}>
            Пропустить
          </button>
          <button type="button" className="fx-btn" onClick={() => onChoose("rename")}>
            Переименовать
          </button>
          <button type="button" className="fx-btn danger" onClick={() => onChoose("replace")}>
            Заменить
          </button>
        </div>
      </div>
    </div>
  );
}