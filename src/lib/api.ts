import { TOKEN_KEY, resolveToken, withoutToken } from './token';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  validateDesktopBootstrap,
  validateDesktopHostStatus,
  validateDesktopWorkspaceRoot,
  type DesktopHostStatus,
} from './desktop-bootstrap';

/** Shown when the server refuses the token: a restarted server has made a new one. */
export const SIGN_IN_HINT = 'The server did not accept this page\'s token. Open the desk with the link the server printed (it ends in ?token=...).';

function storedToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

/** Token is injected into HTML by the server, passed as ?token= query param, or kept by the tab. */
let token = resolveToken({
  injected: (window as unknown as Record<string, string>).__AC_TOKEN__,
  search: window.location.search,
  stored: storedToken(),
});
let apiBaseUrl = '';
let desktopMode = false;
let desktopWorkspaceRoot: string | null = null;
let kept = false;
let initialization: Promise<boolean> | undefined;
let lastBootstrapRefresh = 0;
let bootstrapRefresh: Promise<void> | undefined;

async function refreshDesktopBootstrap(force = false): Promise<void> {
  if (!isTauri()) return;
  if (!force && Date.now() - lastBootstrapRefresh < 1000) return;
  if (bootstrapRefresh) return bootstrapRefresh;
  bootstrapRefresh = (async () => {
    const response = await invoke<unknown>('desktop_bootstrap');
    const bootstrap = validateDesktopBootstrap(response);
    desktopMode = true;
    apiBaseUrl = bootstrap.apiBaseUrl;
    token = bootstrap.token;
    lastBootstrapRefresh = Date.now();
  })();
  try {
    await bootstrapRefresh;
  } finally {
    bootstrapRefresh = undefined;
  }
}

/** Initialize the native host connection before rendering any UI that can call the API. */
export function initializeApi(): Promise<boolean> {
  if (desktopMode) return refreshDesktopBootstrap().then(() => true);
  if (!initialization) {
    initialization = (async () => {
      if (!isTauri()) return true;
      desktopWorkspaceRoot = validateDesktopWorkspaceRoot(
        await invoke<unknown>('desktop_workspace_root'),
      );
      if (!desktopWorkspaceRoot) return false;
      await refreshDesktopBootstrap(true);
      return true;
    })();
  }
  return initialization;
}

export async function getDesktopHostStatus(): Promise<DesktopHostStatus | null> {
  if (!isTauri()) return null;
  const status = validateDesktopHostStatus(await invoke<unknown>('desktop_host_status'));
  if (status.lifecycle === 'running') await refreshDesktopBootstrap();
  return status;
}

export function getDesktopWorkspaceRoot(): string | null {
  return desktopWorkspaceRoot;
}

/** Open the native folder picker and restart the host against the selected workspace. */
export async function chooseDesktopWorkspace(): Promise<boolean> {
  if (!isTauri()) throw new Error('Workspace selection is available only in the desktop app.');
  const selected = await invoke<unknown>('desktop_select_workspace');
  if (typeof selected !== 'boolean') throw new Error('Invalid desktop workspace response.');
  return selected;
}

/** Build the host API URL for same-origin browser mode or authenticated desktop mode. */
export function apiUrl(path: string): string {
  return `${apiBaseUrl}/api/agent/${path}`;
}

/** The server took the token: keep it for this tab, and take it out of the address and its history. */
function keepToken(): void {
  if (desktopMode) return;
  if (kept) return;
  kept = true;
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* it lasts this page */ }
  const search = withoutToken(window.location.search);
  if (search !== window.location.search) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
  }
}

/** The server refused the token: forget it, so a reload does not offer it again. */
function forgetToken(): void {
  if (desktopMode) {
    token = '';
    return;
  }
  kept = false;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nothing was kept */ }
}

/** Fetch wrapper with auth token. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const ready = await initializeApi();
  if (!ready) throw new Error('Choose a workspace to start Agent Control.');
  const response = await fetch(apiUrl(path), {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    forgetToken();
    throw new Error(desktopMode ? 'The desktop host rejected its session token. Restart Agent Control.' : SIGN_IN_HINT);
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
  return token;
}
