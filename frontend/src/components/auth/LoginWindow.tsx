import { useState, type FormEvent } from "react";
import { login, AuthApiError } from "../../lib/authApi";
import "./auth.css";

interface LoginWindowProps {
  onSuccess: () => void;
  onNeedsActivation: (login: string, claimCode: string) => void;
}

export default function LoginWindow({
  onSuccess,
  onNeedsActivation,
}: LoginWindowProps) {
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedLogin = loginValue.trim();
    const trimmedPassword = password.trim();

    if (!trimmedLogin || !trimmedPassword) {
      setError("Введите логин и пароль");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await login(trimmedLogin, trimmedPassword);
      onSuccess();
    } catch (err) {
      if (err instanceof AuthApiError && err.reason.includes("not activated")) {
        onNeedsActivation(trimmedLogin, trimmedPassword);
        return;
      }

      // Временно показываем реальную причину для отладки.
      // Когда всё заработает стабильно — можно вернуть общий текст.
      if (err instanceof AuthApiError) {
        setError(`Ошибка входа: ${err.reason}`);
      } else {
        setError("Не удалось подключиться к серверу (проверьте, запущен ли syne-ui-api)");
      }
      console.error("Login error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-overlay">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-title">Syne Study</h1>
        <p className="auth-subtitle">Войдите в свой аккаунт</p>

        <label className="auth-field">
          <span>Логин</span>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            placeholder="Например, 123456"
            disabled={submitting}
          />
        </label>

        <label className="auth-field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль или код приглашения"
            disabled={submitting}
          />
        </label>

        {error ? <div className="auth-error">{error}</div> : null}

        <button type="submit" className="auth-button" disabled={submitting}>
          {submitting ? "Входим..." : "Войти"}
        </button>

        <p className="auth-hint">
          Если это ваш первый вход — введите вместо пароля код приглашения,
          выданный классным руководителем.
        </p>
      </form>
    </div>
  );
}