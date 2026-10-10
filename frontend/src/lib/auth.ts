/** Client-side session token store. Tokens are signed and stateless. */
const KEY = 'rf_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}
