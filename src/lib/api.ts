import { parseAuthToken, withoutToken } from './token';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  validateDesktopBootstrap,
  validateDesktopHostStatus,
  validateDesktopWorkspaceRoot,
  type DesktopHostStatus,
} from './desktop-bootstrap';
import { validateDesktopTools, type DesktopToolName, type DesktopToolStatus } from './desktop-tools';

/** Shown when the process token is rejected; reload performs a new local exchange. */
export const SIGN_IN_HINT = 'The local host rejected its session token. Reload DONWI Desk to authenticate again.';

let token = '';
let apiBaseUrl = '';
let desktopMode = false;
let desktopWorkspaceRoot: string | null = null;
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

async function exchangeStandaloneToken(): Promise<void> {
  const search = withoutToken(window.location.search);
  if (search !== window.location.search) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
  }
  const response = await fetch('/auth', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('The local host refused authentication. Open DONWI Desk from its loopback address.');
  token = parseAuthToken(await response.json());
}

/** Initialize the native host connection before rendering any UI that can call the API. */
export function initializeApi(): Promise<boolean> {
  if (desktopMode) return refreshDesktopBootstrap().then(() => true);
  if (!initialization) {
    initialization = (async () => {
      if (!isTauri()) {
        await exchangeStandaloneToken();
        return true;
      }
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

export async function getDesktopTools(): Promise<DesktopToolStatus[]> {
  return validateDesktopTools(await apiFetch<unknown>('tools'));
}

export async function refreshDesktopToolsFromLoginShell(): Promise<DesktopToolStatus[]> {
  return validateDesktopTools(await apiFetch<unknown>('tools/refresh-login-path', { method: 'POST' }));
}

export async function setDesktopToolOverride(name: DesktopToolName, path: string): Promise<DesktopToolStatus[]> {
  return validateDesktopTools(await apiFetch<unknown>(`tools/${name}`, {
    method: 'PUT', body: JSON.stringify({ path }),
  }));
}

export async function clearDesktopToolOverride(name: DesktopToolName): Promise<DesktopToolStatus[]> {
  return validateDesktopTools(await apiFetch<unknown>(`tools/${name}`, { method: 'DELETE' }));
}

export async function getDesktopAutostartStatus(): Promise<boolean | null> {
  if (!isTauri()) return null;
  return invoke<boolean>('desktop_autostart_status');
}

export async function setDesktopAutostart(enabled: boolean): Promise<boolean> {
  if (!isTauri()) throw new Error('Launch-at-login is available only in the desktop app.');
  return invoke<boolean>('desktop_set_autostart', { enabled });
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

/** Fetch wrapper with auth token. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const ready = await initializeApi();
  if (!ready) throw new Error('Choose a workspace to start DONWI Desk.');
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
    token = '';
    throw new Error(desktopMode ? 'The desktop host rejected its session token. Restart DONWI Desk.' : SIGN_IN_HINT);
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

/** Get the auth token for direct fetch calls (e.g., streaming). */
export function getAuthToken(): string {
  return token;
}
