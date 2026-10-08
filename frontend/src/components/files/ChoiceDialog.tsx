import { useEffect } from "react";
import type { ChoiceRequest } from "./FilesContext";

interface Props {
  req: ChoiceRequest;
  onChoose: (id: string | null) => void;
}

export function ChoiceDialog({ req, onChoose }: Props) {
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
        <h3 className="fx-modal-title">{req.title}</h3>
        <p className="fx-modal-text">{req.text}</p>
        <div className="fx-modal-actions">
          {req.buttons.map((b) => (
            <button key={b.id} type="button" className={`fx-btn${b.kind ? ` ${b.kind}` : ""}`} onClick={() => onChoose(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}