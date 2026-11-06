import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDesktopReadyLine } from './desktop-protocol.js';

const children: ChildProcessWithoutNullStreams[] = [];
after(() => {
  for (const child of children) child.kill('SIGTERM');
});

describe('desktop host bootstrap', () => {
  it('reports private readiness and rejects unauthenticated, query-token, and foreign-origin requests', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-control-desktop-test-'));
    await mkdir(join(root, '.agents', 'standards'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), '# Test workspace\n');
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AC_DESKTOP_MODE: '1',
        HOST: '127.0.0.1',
        PORT: '3141',
        HOME: root,
        WS_WORKSPACE_ROOT: root,
      },
      stdio: 'pipe',
    });
    children.push(child);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    try {
      const line = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        const timeout = setTimeout(() => reject(new Error('desktop host did not become ready')), 10_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk;
          const end = buffer.indexOf('\n');
          if (end < 0) return;
          clearTimeout(timeout);
          resolve(buffer.slice(0, end));
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`desktop host exited before readiness (${code}): ${stderr}`));
        });
      });
      const ready = parseDesktopReadyLine(line);
      assert.ok(ready.port > 0);
      assert.doesNotMatch(line, /https?:\/\/[^\s]*\?token=/i);
      assert.doesNotMatch(stderr, new RegExp(ready.token));

      const origin = 'tauri://localhost';
      const endpoint = `http://${ready.host}:${ready.port}/api/agent/providers`;
      assert.equal((await fetch(endpoint, { headers: { Origin: origin } })).status, 401);
      assert.equal((await fetch(`${endpoint}?token=${ready.token}`, { headers: { Origin: origin } })).status, 401);
      assert.equal((await fetch(endpoint, {
        headers: { Origin: 'https://attacker.invalid', Authorization: `Bearer ${ready.token}` },
      })).status, 403);
      const authorized = await fetch(endpoint, {
        headers: { Origin: origin, Authorization: `Bearer ${ready.token}` },
      });
      assert.equal(authorized.status, 200);
      assert.equal((await fetch(`http://${ready.host}:${ready.port}/`)).status, 404);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
