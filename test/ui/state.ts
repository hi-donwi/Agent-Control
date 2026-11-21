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
  /** Token returned by the loopback-only GET /auth exchange for direct API assertions. */
  token: string;
  /** The isolated `HOME` the server ran with - where its `~/.agent-control/config.json` lives. */
  home: string;
  /** The disposable workspace root (`WS_WORKSPACE_ROOT`). */
  root: string;
}

export const serverEntry = () => join(REPO_ROOT, 'server', 'index.ts');
