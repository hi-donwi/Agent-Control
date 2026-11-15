import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
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
type TestToolStatus = { name: string; path: string | null; source: string; overridden: boolean };

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

test('desktop dependency status and overrides are authenticated, persistent, and separate from endpoint config', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'agent-control-tools-test-'));
  const home = resolve(root, 'home');
  const workspace = resolve(root, 'workspace');
  await mkdir(resolve(workspace, '.agents', 'standards'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(resolve(workspace, 'AGENTS.md'), 'Test workspace.\n');
  const appDirectory = resolve(home, '.agent-control');
  await mkdir(appDirectory, { recursive: true });
  const configPath = resolve(appDirectory, 'config.json');
  await writeFile(configPath, '{"endpointConfig":"leave unchanged"}\n');
  const fakeRg = resolve(root, 'fake-bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
  await mkdir(dirname(fakeRg), { recursive: true });
  await writeFile(fakeRg, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') await chmod(fakeRg, 0o700);

  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(home, workspace);
    const endpoint = `http://${host.bootstrap.host}:${host.bootstrap.port}/api/agent/tools`;
    const origin = 'tauri://localhost';
    assert.equal((await fetch(endpoint, { headers: { Origin: origin } })).status, 401);
    const auth = { Origin: origin, Authorization: `Bearer ${host.bootstrap.token}` };
    const listed = await fetch(endpoint, { headers: auth });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { tools: TestToolStatus[] };
    assert.deepEqual(listedBody.tools.map((tool) => tool.name), ['ws', 'brain', 'rg', 'git']);

    const saved = await fetch(`${endpoint}/rg`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fakeRg }),
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as { tools: TestToolStatus[] };
    const rg = savedBody.tools.find((tool) => tool.name === 'rg');
    assert.ok(rg, 'the locator status includes ripgrep');
    assert.equal(rg.source, 'override');
    assert.equal(rg.path, await realpath(fakeRg));

    const overridePath = resolve(appDirectory, 'tool-paths.json');
    assert.equal(JSON.parse(await readFile(overridePath, 'utf8')).overrides.rg, rg.path);
    assert.equal(await readFile(configPath, 'utf8'), '{"endpointConfig":"leave unchanged"}\n');
    if (process.platform !== 'win32') assert.equal((await stat(overridePath)).mode & 0o777, 0o600);

    const reset = await fetch(`${endpoint}/rg`, { method: 'DELETE', headers: auth });
    assert.equal(reset.status, 200);
    const resetBody = await reset.json() as { tools: TestToolStatus[] };
    assert.equal(resetBody.tools.find((tool) => tool.name === 'rg')?.overridden, false);
    await stopHost(host.child);
    host.lines.close();
    host = undefined;
  } finally {
    if (host && host.child.exitCode === null && host.child.signalCode === null) host.child.kill();
    host?.lines.close();
    await rm(root, { recursive: true, force: true });
  }
});
