import { TOKEN_KEY, resolveToken, withoutToken } from './token';

/** Shown when the server refuses the token: a restarted server has made a new one. */
export const SIGN_IN_HINT = 'The server did not accept this page\'s token. Open the desk with the link the server printed (it ends in ?token=...).';

function storedToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

/** Token is injected into HTML by the server, passed as ?token= query param, or kept by the tab. */
const TOKEN = resolveToken({
  injected: (window as unknown as Record<string, string>).__AC_TOKEN__,
  search: window.location.search,
  stored: storedToken(),
});
let kept = false;

/** The server took the token: keep it for this tab, and take it out of the address and its history. */
function keepToken(): void {
  if (kept) return;
  kept = true;
  try { sessionStorage.setItem(TOKEN_KEY, TOKEN); } catch { /* it lasts this page */ }
  const search = withoutToken(window.location.search);
  if (search !== window.location.search) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
  }
}

/** The server refused the token: forget it, so a reload does not offer it again. */
function forgetToken(): void {
  kept = false;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nothing was kept */ }
}

/** Fetch wrapper with auth token. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/agent/${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    forgetToken();
    throw new Error(SIGN_IN_HINT);
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  keepToken();
  return response.json() as Promise<T>;
}

/** Get the auth token for direct fetch calls (e.g., streaming). */
export function getAuthToken(): string {
  return TOKEN;
}
