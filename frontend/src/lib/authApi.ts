import { authHeaders, getApiBase, whenApiReady } from "./api";

export class AuthApiError extends Error {
  reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    await whenApiReady();

    response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError("network_error");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AuthApiError(
      typeof data.error === "string" ? data.error : "unknown_error",
    );
  }

  return data as T;
}

export function login(loginId: string, password: string) {
  return postJson<{ ok: boolean }>("/api/auth/login", {
    login: loginId,
    password,
  });
}

export function claimAccount(loginId: string, claimCode: string, password: string) {
  return postJson<{ ok: boolean }>("/api/auth/claim", {
    login: loginId,
    claim_code: claimCode,
    password,
  });
}