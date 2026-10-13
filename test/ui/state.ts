import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Where the global setup records the origin the tests drive. It is a file rather than an
 * environment variable because Playwright runs setup and tests in separate processes.
 */
export const STATE_FILE = fileURLToPath(new URL('../../.playwright/state.json', import.meta.url));
/** The repository root: `test/ui/` is two levels down. */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface ServerState {
  origin: string;
  /**
   * The bearer token. It is read from the URL the server prints, not from the inline
   * `window.__AC_TOKEN__` script: the host's CSP (`script-src 'self'`) blocks inline
   * scripts, so that script never runs - the printed `?token=` URL is what works.
   */
  token: string;
}

export const serverEntry = () => join(REPO_ROOT, 'server', 'index.ts');
