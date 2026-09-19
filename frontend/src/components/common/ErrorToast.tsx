interface ErrorToastProps {
  error: string;
  errorToastKey: number;
}

export default function ErrorToast({
  error,
  errorToastKey,
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
    </div>
  );
}