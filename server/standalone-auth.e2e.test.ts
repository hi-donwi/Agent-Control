import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverEntry = fileURLToPath(new URL('./index.ts', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      probe.close(() => resolve(address.port));
    });
  });
}

async function startStandaloneHost() {
  const root = await mkdtemp(join(tmpdir(), 'desk-auth-workspace-'));
  const home = await mkdtemp(join(tmpdir(), 'desk-auth-home-'));
  await mkdir(join(root, '.agents', 'standards'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), '# Test workspace\n');
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      HOST: '127.0.0.1',
      PORT: String(port),
      WS_WORKSPACE_ROOT: root,
      NODE_ENV: 'production',
      AC_RATE_LIMIT_PER_MINUTE: '1000',
    },
    stdio: 'ignore',
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`standalone host exited before readiness (${child.exitCode})`);
    try {
      await fetch(`${origin}/`);
      return { child, home, origin, root };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill('SIGTERM');
  throw new Error('standalone host did not become ready');
}

async function stopHost(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exit;
}

test('standalone startup refuses a non-loopback HOST before workspace discovery', { timeout: 30_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-host-rejection-'));
  const child = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      HOST: '0.0.0.0',
      PORT: '3141',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

  try {
    const exit = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    // The full suite runs many TypeScript workers in parallel, so leave startup
    // enough time to load the server before treating it as hung.
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const code = await exit;
    clearTimeout(timer);
    assert.notEqual(code, 0);
    assert.match(stderr, /Standalone host must bind to 127\.0\.0\.1/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(home, { recursive: true, force: true });
  }
});

test('standalone token is exchanged only through loopback GET /auth', { timeout: 20_000 }, async () => {
  const host = await startStandaloneHost();
  try {
    const response = await fetch(`${host.origin}/auth`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/, 'GET /auth returns a JSON token');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as { token?: string };
    assert.match(body.token ?? '', /^[a-f0-9]{64}$/);
    const page = await fetch(`${host.origin}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.doesNotMatch(html, new RegExp(body.token!));
    assert.doesNotMatch(html, /__AC_TOKEN__/);

    const foreignOrigin = await fetch(`${host.origin}/auth`, {
      headers: { Origin: 'https://attacker.invalid' },
    });
    assert.equal(foreignOrigin.status, 403);
    const nonGet = await fetch(`${host.origin}/auth`, { method: 'POST' });
    assert.notEqual(nonGet.status, 200);

    const authorized = await fetch(`${host.origin}/api/agent/providers`, {
      headers: { Origin: host.origin, Authorization: `Bearer ${body.token}` },
    });
    assert.equal(authorized.status, 200);
    const missingOrigin = await fetch(`${host.origin}/api/agent/providers`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    assert.equal(missingOrigin.status, 403);
    const foreignApiOrigin = await fetch(`${host.origin}/api/agent/providers`, {
      headers: { Origin: 'https://attacker.invalid', Authorization: `Bearer ${body.token}` },
    });
    assert.equal(foreignApiOrigin.status, 403);

    const queryToken = await fetch(`${host.origin}/api/agent/providers?token=${body.token}`, {
      headers: { Origin: host.origin },
    });
    assert.equal(queryToken.status, 401);
  } finally {
    await stopHost(host.child);
    await rm(host.root, { recursive: true, force: true });
    await rm(host.home, { recursive: true, force: true });
  }
});
