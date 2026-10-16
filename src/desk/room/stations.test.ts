import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canMove, cardsFrom, moveRequest } from './stations';

const detail = {
  tasks: [
    { id: 'task_a', title: 'Export CSV', status: 'in_progress', priority: 'high', owner: 'dev', blocked: '', blockedReason: '', revision: 'r1' },
    { id: 'task_b', title: 'Get keys', status: 'ready', priority: 'normal', owner: 'dev', blocked: 'yes', blockedReason: 'client IT', revision: 'r2' },
  ],
  plans: [
    { runId: 'run-1', run: 'Add export', n: '1', task: 'Write parser', status: 'done', notes: '', revision: 'p1' },
    { runId: 'run-1', run: 'Add export', n: '2', task: 'Wire route', status: 'blocked', notes: 'waits on API', revision: 'p1' },
    { runId: 'run-1', run: 'Add export', n: '3', task: 'Old idea', status: 'dropped', notes: 'no', revision: 'p1' },
    { runId: 'run-1', run: 'Add export', n: '4', task: '', status: 'pending', notes: '', revision: 'p1' },
  ],
};

describe('mission board stations', () => {
  it('places tasks and plan steps, carries blockers, and leaves dropped and empty steps out', () => {
    const cards = cardsFrom(detail);
    assert.deepEqual(cards.map((c) => [c.key, c.station, c.blocked, c.reason]), [
      ['task:task_a', 'hands', false, ''],
      ['task:task_b', 'ready', true, 'client IT'],
      ['step:run-1#1', 'shipped', false, ''],
      ['step:run-1#2', 'queue', true, 'waits on API'],
    ]);
  });

  it('lets a task go anywhere but a plan step only to its three stations', () => {
    const [task, , step] = cardsFrom(detail);
    assert.equal(canMove(task, 'review'), true);
    assert.equal(canMove(task, 'hands'), false);
    assert.equal(canMove(step, 'review'), false);
    assert.equal(canMove(step, 'hands'), true);
  });

  it('builds the ws-backed request with the revision the card was read at', () => {
    const [task, , step] = cardsFrom(detail);
    assert.deepEqual(moveRequest(task, 'review', 'alpha'), { path: 'desk/tasks/status', body: { project: 'alpha', id: 'task_a', status: 'review', revision: 'r1' } });
    assert.deepEqual(moveRequest(step, 'hands', 'alpha'), { path: 'desk/plan/status', body: { project: 'alpha', run: 'run-1', n: '1', status: 'in_progress', revision: 'p1' } });
  });
});
