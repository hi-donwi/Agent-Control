import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { followTask, linkedTask } from './workflow.js';
import type { CodingSession } from './coding-sessions.js';
import type { HandBackDeps } from './hand-back.js';

const session = (cardKey?: string): CodingSession => ({
  id: 's1', project: 'demo', worktree: '/w', branch: 'b', startedAt: '2026-10-17T00:00:00Z', ...(cardKey ? { cardKey } : {}),
});

function fakeWs(failStatus = false) {
  const calls: string[][] = [];
  const deps: HandBackDeps = {
    ws: async (args) => {
      calls.push(args);
      return failStatus && args[1] === 'status' ? { code: 1, stdout: '', stderr: 'workspace tasks: no task\n' } : { code: 0, stdout: '', stderr: '' };
    },
  };
  return { deps, calls };
}

describe('workflow rules', () => {
  it('links a session to the task it was started for, not to a run step', () => {
    assert.equal(linkedTask(session('task:task_export_csv')), 'task_export_csv');
    assert.equal(linkedTask(session('step:run-1#2')), '');
    assert.equal(linkedTask(session()), '');
    assert.equal(linkedTask(session('task:../x')), '');
  });

  it('moves the linked task with the session and says why in its activity', async () => {
    for (const [event, status] of [['verified', 'review'], ['shipped', 'done'], ['discarded', 'ready']] as const) {
      const { deps, calls } = fakeWs();
      assert.equal(await followTask(deps, session('task:task_x'), event, `note for ${event}`), status);
      assert.deepEqual(calls, [['task', 'status', 'demo', 'task_x', status], ['task', 'comment', 'demo', 'task_x', `note for ${event}`]]);
    }
  });

  it('does nothing without a linked task, and reports a refused move without failing', async () => {
    const quiet = fakeWs();
    assert.equal(await followTask(quiet.deps, session(), 'shipped', 'x'), null);
    assert.deepEqual(quiet.calls, []);
    const refused = fakeWs(true);
    assert.match(String(await followTask(refused.deps, session('task:task_x'), 'shipped', 'x')), /\[WARN\] task_x stays where it was: workspace tasks: no task/);
    assert.equal(refused.calls.length, 1);
  });
});
