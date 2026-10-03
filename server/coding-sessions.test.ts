import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodingSession, startCodingSession, stopCodingSession, type SessionRunner } from './coding-sessions.js';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ac-coding-'));
}

function fakeRunner(worktree = '/tmp/fake-worktree'): SessionRunner & { calls: Array<{ args: string[]; env: Record<string, string> }> } {
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  return {
    calls,
    runWs: async (args, env) => {
      calls.push({ args, env });
      if (args[0] === 'agent' && args[1] === 'start') {
        // Real `ws agent start` output: colour codes around a plain `cd <path>` line.
        return `\u001b[32m-> agent start demo (session x)\u001b[0m\ncd ${worktree}\n\u001b[2m  do not...\u001b[0m\n`;
      }
      return '';
    },
    currentBranch: async () => 'agent-x-demo-works',
  };
}

describe('startCodingSession', () => {
  it('starts one, records it, and returns it', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    const session = await startCodingSession(root, 'demo', runner);
    assert.equal(session.project, 'demo');
    assert.equal(session.worktree, '/tmp/fake-worktree');
    assert.equal(session.branch, 'agent-x-demo-works');
    assert.match(session.id, /^[a-f0-9-]{16,}$/);
    assert.deepEqual(readCodingSession(root, 'demo'), session);
    const [call] = runner.calls;
    assert.deepEqual(call.args, ['agent', 'start', 'demo', `agent-control coding session ${session.id}`]);
    assert.equal(call.env.WS_SESSION_ID, session.id);
    assert.equal(call.env.WS_AGENT, 'agent-control');
  });

  it('is idempotent: a second call returns the same session without starting another', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    const first = await startCodingSession(root, 'demo', runner);
    const second = await startCodingSession(root, 'demo', runner);
    assert.deepEqual(first, second);
    assert.equal(runner.calls.length, 1);
  });

  it('throws when ws reports no worktree path', async () => {
    const root = tmpRoot();
    const noPath: SessionRunner = { runWs: async () => 'no cd line here\n', currentBranch: async () => 'x' };
    await assert.rejects(() => startCodingSession(root, 'demo', noPath), /did not report a worktree path/);
  });

  it('refuses a project key that is a path', async () => {
    await assert.rejects(() => startCodingSession(tmpRoot(), '../etc', fakeRunner()), /project key/);
  });
});

describe('stopCodingSession', () => {
  it('stops an active session and removes its record', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    const session = await startCodingSession(root, 'demo', runner);
    const stopped = await stopCodingSession(root, 'demo', runner);
    assert.equal(stopped, true);
    assert.equal(readCodingSession(root, 'demo'), null);
    const stopCall = runner.calls.find((c) => c.args[0] === 'agent' && c.args[1] === 'stop');
    assert.ok(stopCall);
    assert.equal(stopCall?.env.WS_SESSION_ID, session.id);
  });

  it('is a no-op, not an error, when there is nothing to stop', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    assert.equal(await stopCodingSession(root, 'demo', runner), false);
    assert.equal(runner.calls.length, 0);
  });
});

describe('readCodingSession', () => {
  it('is null for a project with no session file, or an unparseable one', () => {
    const root = tmpRoot();
    assert.equal(readCodingSession(root, 'demo'), null);
  });

  it('is 0600 on disk', async () => {
    const root = tmpRoot();
    await startCodingSession(root, 'demo', fakeRunner());
    const { statSync } = await import('node:fs');
    assert.equal(statSync(join(root, '.local', 'agent', 'coding-sessions', 'demo.json')).mode & 0o777, 0o600);
  });
});
