import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import test from 'node:test';

import { parseDesktopReadyLine } from './desktop-protocol.js';
import { DESKTOP_SHUTDOWN_COMMAND } from './desktop-shutdown.js';

const serverEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const repoRoot = resolve(dirname(serverEntry), '..');

async function startHost(home: string, workspace: string, port = '0', token?: string) {
  const env = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  };
  const child = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
    cwd: repoRoot,
    env: {
      ...env,
      HOME: home,
      USERPROFILE: home,
      AC_DESKTOP_MODE: '1',
      HOST: '127.0.0.1',
      PORT: port,
      WS_WORKSPACE_ROOT: workspace,
      ...(token ? { AC_DESKTOP_TOKEN: token } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  const lines = createInterface({ input: child.stdout });
  const readyLine = await Promise.race([
    once(lines, 'line').then(([line]) => String(line)),
    once(child, 'exit').then(([code]) => { throw new Error(`desktop host exited before ready (${String(code)})`); }),
  ]);
  return { child, lines, bootstrap: parseDesktopReadyLine(readyLine) };
}

async function stopHost(child: ChildProcessWithoutNullStreams): Promise<void> {
  const exit = once(child, 'exit');
  child.stdin.write(`${DESKTOP_SHUTDOWN_COMMAND}\n`);
  const result = await Promise.race([
    exit.then(() => 'exited'),
    new Promise<'timeout'>((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 4000)),
  ]);
  if (result === 'timeout') {
    child.kill();
    throw new Error('desktop host did not honor graceful shutdown');
  }
}

test('desktop host can restart on its reserved loopback port with the same session token', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'agent-control-host-test-'));
  const home = resolve(root, 'home');
  const workspace = resolve(root, 'workspace');
  await mkdir(resolve(workspace, '.agents', 'standards'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(resolve(workspace, 'AGENTS.md'), 'Test workspace.\n');

  let first: Awaited<ReturnType<typeof startHost>> | undefined;
  let second: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    first = await startHost(home, workspace);
    await stopHost(first.child);
    first.lines.close();

    second = await startHost(home, workspace, String(first.bootstrap.port), first.bootstrap.token);
    assert.equal(second.bootstrap.port, first.bootstrap.port);
    assert.equal(second.bootstrap.token, first.bootstrap.token);
    await stopHost(second.child);
    second.lines.close();
  } finally {
    for (const host of [first, second]) {
      if (host && host.child.exitCode === null && host.child.signalCode === null) {
        host.child.kill('SIGKILL');
      }
      host?.lines.close();
    }
    await rm(root, { recursive: true, force: true });
  }
});
