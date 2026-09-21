import { useState } from "react";
import LoginWindow from "./LoginWindow";
import SetPasswordWindow from "./SetPasswordWindow";

interface AuthGateProps {
  onAuthenticated: () => void;
}

type AuthMode =
  | { view: "login" }
  | { view: "set-password"; login: string; claimCode: string };

export default function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>({ view: "login" });

  if (mode.view === "set-password") {
    return (
      <SetPasswordWindow
        loginValue={mode.login}
        initialClaimCode={mode.claimCode}
        onSuccess={onAuthenticated}
        onBack={() => setMode({ view: "login" })}
      />
    );
  }

  return (
    <LoginWindow
      onSuccess={onAuthenticated}
      onNeedsActivation={(loginValue, claimCode) =>
        setMode({ view: "set-password", login: loginValue, claimCode })
      }
    />
  );
}