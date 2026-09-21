import { useState, type FormEvent } from "react";
import { claimAccount, AuthApiError } from "../../lib/authApi";
import "./auth.css";

interface SetPasswordWindowProps {
  loginValue: string;
  initialClaimCode: string;
  onSuccess: () => void;
  onBack: () => void;
}

export default function SetPasswordWindow({
  loginValue,
  initialClaimCode,
  onSuccess,
  onBack,
}: SetPasswordWindowProps) {
  const [claimCode, setClaimCode] = useState(initialClaimCode);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const code = claimCode.trim();

    if (!code) {
      setError("Введите код приглашения");
      return;
    }
    if (password.length < 6) {
      setError("Пароль должен содержать не менее 6 символов");
      return;
    }
    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await claimAccount(loginValue, code, password);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof AuthApiError
          ? "Не удалось активировать аккаунт: неверный логин или код приглашения"
          : "Не удалось подключиться к серверу",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-overlay">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-title">Создание пароля</h1>
        <p className="auth-subtitle">
          Логин <strong>{loginValue}</strong> ещё не активирован. Придумайте
          пароль, чтобы завершить регистрацию.
        </p>

        <label className="auth-field">
          <span>Код приглашения</span>
          <input
            type="text"
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="auth-field">
          <span>Новый пароль</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="auth-field">
          <span>Повторите пароль</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting}
          />
        </label>

        {error ? <div className="auth-error">{error}</div> : null}

        <div className="auth-actions">
          <button
            type="button"
            className="auth-button auth-button-secondary"
            onClick={onBack}
            disabled={submitting}
          >
            Назад
          </button>
          <button type="submit" className="auth-button" disabled={submitting}>
            {submitting ? "Сохраняем..." : "Создать пароль"}
          </button>
        </div>
      </form>
    </div>
  );
}