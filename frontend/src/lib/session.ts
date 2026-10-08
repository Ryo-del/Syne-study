let sessionLogin = "";

export function setSessionLogin(login: string) {
  sessionLogin = login.trim();
}

export function getSessionLogin() {
  return sessionLogin;
}