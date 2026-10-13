import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end chat against the real entry point (server/index.ts), not a unit seam.
 *
 * The workspace is disposable and its `mock` endpoint answers offline, so this exercises
 * the whole path - loopback gate, token, endpoint load, egress policy, the AI SDK stream,
 * and our line protocol - without a network call. It is the pattern to extend when a
 * browser harness lands (it would drive the same server).
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));

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

/** Lines of the line protocol with empty ones dropped, as the UI reads them. */
async function protocolLines(response: Response): Promise<string[]> {
  return (await response.text()).split('\n').filter(Boolean);
}

const answerText = (lines: string[]) => lines.filter((l) => l.startsWith('0:')).map((l) => JSON.parse(l.slice(2)) as string).join('');

describe('chat end to end with the mock provider (ADR-0019 follow-up)', { timeout: 30_000 }, () => {
  let root: string;
  let home: string;
  let child: ChildProcess;
  let origin: string;
  let token: string;

  const post = (body: unknown) =>
    fetch(`${origin}/api/agent/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'ac-e2e-'));
    home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    mkdirSync(join(root, '.agents', 'standards'), { recursive: true });
    mkdirSync(join(root, '.agents', 'bin'), { recursive: true });
    mkdirSync(join(root, '.local', 'agent'), { recursive: true });
    mkdirSync(join(root, 'context'), { recursive: true });
    mkdirSync(join(root, 'projects', 'mock', 'mockproj'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), '# mock workspace\n');
    writeFileSync(join(root, 'context', 'registry.tsv'), 'key\tclient\tgroup\tfolder\nmockproj\tframework\t-\tprojects/mock/mockproj\n');
    writeFileSync(join(root, '.local', 'agent', 'endpoints.json'), JSON.stringify({
      endpoints: {
        mock: { protocol: 'mock', models: ['echo'] },
        remote: { protocol: 'openai-chat', baseUrl: 'https://example.invalid/v1', models: ['x'] },
      },
    }));
    // The bridge shells out to `<root>/.agents/bin/ws`; stub the CLI boundary so the
    // project-bound path runs without a real workspace or the network.
    const ws = join(root, '.agents', 'bin', 'ws');
    writeFileSync(ws, '#!/bin/sh\nprintf "mockproj\\tframework\\t-\\tprojects/mock/mockproj\\t-\\t-\\t-\\n"\n');
    chmodSync(ws, 0o755);

    const port = await freePort();
    child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home, WS_WORKSPACE_ROOT: root, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr?.on('data', () => { /* server logs are not the point of the test */ });

    token = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error(`server did not print a token:\n${buffer}`)), 20_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const match = buffer.match(/Open: http:\/\/\S+\?token=([a-f0-9]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (code ${code}):\n${buffer}`)); });
    });
    origin = `http://127.0.0.1:${port}`;
  });

  after(() => {
    child?.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('streams the mock answer over the line protocol, with no network call', async () => {
    const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'mock', model: 'echo' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
    const lines = await protocolLines(response);
    assert.equal(answerText(lines), 'mock(echo): hello');
    assert.equal(JSON.parse(lines.at(-1)!.slice(2)).finishReason, 'stop');
  });

  it('streams the same answer for a chat bound to a project', async () => {
    const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'mock', model: 'echo', project: 'mockproj' });
    assert.equal(response.status, 200);
    assert.equal(answerText(await protocolLines(response)), 'mock(echo): hello');
  });

  it('refuses a remote endpoint without a project policy, before any request', async () => {
    const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'remote', model: 'x' });
    assert.equal(response.status, 403);
    assert.match((await response.json() as { error: string }).error, /remote/);
  });
});
