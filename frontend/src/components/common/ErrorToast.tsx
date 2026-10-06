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
        onClick={onClose}
      >
        Сообщить об ошибке и закрыть
      </button>
    </div>
  );
}