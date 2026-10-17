import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listCodingSessions, readCodingSession, startCodingSession, stopCodingSession, type SessionRunner } from './coding-sessions.js';

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
        const suffix = env.WS_SESSION_ID ? `-${env.WS_SESSION_ID.slice(0, 6)}` : '';
        return `\u001b[32m-> agent start demo (session x)\u001b[0m\ncd ${worktree}${suffix}\n\u001b[2m  do not...\u001b[0m\n`;
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
    assert.match(session.worktree, /fake-worktree/);
    assert.equal(session.branch, 'agent-x-demo-works');
    assert.match(session.id, /^[a-f0-9-]{16,}$/);
    assert.deepEqual(readCodingSession(root, 'demo'), session);
    const [call] = runner.calls;
    assert.deepEqual(call.args, ['agent', 'start', 'demo', `agent-control coding session ${session.id}`]);
    assert.equal(call.env.WS_SESSION_ID, session.id);
    assert.equal(call.env.WS_AGENT, 'agent-control');
  });

  it('passes brief as the agent start reason and records brief and cardKey', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    const session = await startCodingSession(root, 'demo', runner, { brief: 'Fix navigation layout', cardKey: 'task:task-1' });
    assert.equal(session.brief, 'Fix navigation layout');
    assert.equal(session.cardKey, 'task:task-1');
    const [call] = runner.calls;
    assert.deepEqual(call.args, ['agent', 'start', 'demo', 'agent-control: Fix navigation layout']);
  });

  it('is idempotent: a second call returns the same session without starting another', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    const first = await startCodingSession(root, 'demo', runner);
    const second = await startCodingSession(root, 'demo', runner);
    assert.deepEqual(first, second);
    assert.equal(runner.calls.length, 1);
  });

  it('allows starting parallel sessions for distinct card keys', async () => {
    const root = tmpRoot();
    const runner = fakeRunner();
    const s1 = await startCodingSession(root, 'demo', runner, { brief: 'Task 1', cardKey: 'task:1', allowParallel: true });
    const s2 = await startCodingSession(root, 'demo', runner, { brief: 'Task 2', cardKey: 'task:2', allowParallel: true });

    assert.notEqual(s1.id, s2.id);
    assert.notEqual(s1.worktree, s2.worktree);
    assert.equal(s1.cardKey, 'task:1');
    assert.equal(s2.cardKey, 'task:2');

    const all = listCodingSessions(root, 'demo');
    assert.equal(all.length, 2);
    assert.deepEqual(readCodingSession(root, 'demo', s1.id), s1);
    assert.deepEqual(readCodingSession(root, 'demo', s2.id), s2);

    // Stop s1 only
    const stoppedS1 = await stopCodingSession(root, 'demo', runner, s1.id);
    assert.equal(stoppedS1, true);

    const remaining = listCodingSessions(root, 'demo');
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, s2.id);
    assert.equal(readCodingSession(root, 'demo', s1.id), null);
    assert.deepEqual(readCodingSession(root, 'demo', s2.id), s2);
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
