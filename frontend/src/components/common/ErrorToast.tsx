import { useState } from "react";
import { request } from "../../lib/api";

interface ErrorToastProps {
  error: string;
  errorToastKey: number;
  onClose: () => void;
}

export default function ErrorToast({
  error,
  errorToastKey,
  onClose,
}: ErrorToastProps) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  if (!error) {
    return null;
  }

  return (
    <div
      key={errorToastKey}
      className="error-toast"
      role="alert"
      aria-live="assertive"
    >
      <span className="error-toast-title">
        Error
      </span>

      <p>{error}</p>

      <button
        id="Btnsend"
        className="Btnsend"
        disabled={sending}
        onClick={async () => {
          setSending(true);
          setSendError("");
          try {
            await request<{ ok: boolean }>("/api/errors/report", {
              method: "POST",
              body: JSON.stringify({ error }),
            });
            onClose();
          } catch (err) {
            setSendError(`Не удалось отправить: ${String(err)}`);
          } finally {
            setSending(false);
          }
        }}
      >
        {sending ? "Отправка…" : "Сообщить об ошибке и закрыть"}
      </button>
      {sendError && <p role="alert" className="error-toast-send-error">{sendError}</p>}
    </div>
  );
}
