import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { REPO_ROOT, STATE_FILE, serverEntry, type ServerState } from './state.js';
import { createWorkspace, removeWorkspace, type Workspace } from './workspace.js';

const READY_TIMEOUT_MS = 30_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      probe.close(() => resolve(address.port));
    });
  });
}

/** Polls the UI until it answers, so a failed build or boot fails the run with its log. */
async function waitForUi(child: ChildProcess, origin: string, log: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited (code ${child.exitCode}):\n${log()}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not answer ${origin} in ${READY_TIMEOUT_MS}ms:\n${log()}`);
}

/**
 * Drives the real thing: builds the UI, starts the real entry point against a disposable
 * workspace, and records its origin for the specs. The returned function is Playwright's
 * teardown - the server, the workspace, and the isolated home all go away with it.
 */
export default async function globalSetup(): Promise<() => void> {
  execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });

  const workspace: Workspace = createWorkspace();
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: workspace.home, WS_WORKSPACE_ROOT: workspace.root, HOST: '127.0.0.1', PORT: String(port),
    NODE_ENV: 'production', AC_STUB_WORKTREE: workspace.worktree,
    // Every spec loads the page afresh; the whole suite passes the default 120 requests a minute.
    AC_RATE_LIMIT_PER_MINUTE: '1000',
  };
  // Standalone app, not the agent mode that proxies the control plane.
  delete env.WS_AGENT_MODE;
  delete env.WS_DESK_DIST;
  delete env.WS_CONTROL_URL;
  delete env.WS_CONTROL_TOKEN;

  const child = spawn(process.execPath, ['--import', 'tsx', serverEntry()], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  const collect = (chunk: Buffer) => { log += chunk.toString('utf8'); };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const origin = `http://127.0.0.1:${port}`;
  await waitForUi(child, origin, () => log);

  const token = log.match(/Open: http:\/\/\S+\?token=([a-f0-9]{64})/)?.[1];
  if (!token) throw new Error(`server did not print its token:\n${log}`);

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ origin, token, home: workspace.home, root: workspace.root } satisfies ServerState) + '\n');

  return () => {
    child.kill('SIGKILL');
    removeWorkspace(workspace);
  };
}
