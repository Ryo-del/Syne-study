import { useEffect, useRef, useState } from "react";

interface Props {
  disabled: boolean;
  onPickPhoto: () => void;
  onPickFile: () => void;
  onPickFromFiles: () => void;
}

export default function AttachMenu({ disabled, onPickPhoto, onPickFile, onPickFromFiles }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="attach-anchor">
      <button
        type="button"
        className="attach-btn"
        disabled={disabled}
        title={disabled ? "Отправка файлов недоступна в этом чате" : "Прикрепить"}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      {open && (
        <div className="attach-menu" role="menu">
          <button type="button" className="attach-item" onClick={run(onPickPhoto)}>
            🖼 Фото с компьютера
          </button>
          <button type="button" className="attach-item" onClick={run(onPickFile)}>
            📄 Файл с компьютера
          </button>
          <button type="button" className="attach-item" onClick={run(onPickFromFiles)}>
            🗂 Из Files
          </button>
        </div>
      )}
    </div>
  );
}