import { useEffect } from "react";

interface Props {
  src: string;
  name: string;
  onClose: () => void;
  onDownload: () => void;
}

export default function Lightbox({ src, name, onClose, onDownload }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt={name} draggable={false} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{name}</span>
        <button type="button" className="ghost-tiny" onClick={onDownload}>
          Скачать
        </button>
        <button type="button" className="ghost-tiny" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}