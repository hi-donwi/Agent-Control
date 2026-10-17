import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canAssign, canMove, cardsFrom, holdActions, holdRequest, moveRequest, releaseRequest } from './stations';

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

  it('allows assignment to agent only for cards at ready station', () => {
    const [inProgressTask, readyTask] = cardsFrom(detail);
    assert.equal(canAssign(readyTask), true);
    assert.equal(canAssign(inProgressTask), false);
  });

  it('builds the ws-backed request with the revision the card was read at', () => {
    const [task, , step] = cardsFrom(detail);
    assert.deepEqual(moveRequest(task, 'review', 'alpha'), { path: 'desk/tasks/status', body: { project: 'alpha', id: 'task_a', status: 'review', revision: 'r1' } });
    assert.deepEqual(moveRequest(step, 'hands', 'alpha'), { path: 'desk/plan/status', body: { project: 'alpha', run: 'run-1', n: '1', status: 'in_progress', revision: 'p1' } });
  });

  it('offers block to open tasks, block and drop to open steps, and nothing to blocked or shipped cards', () => {
    const [task, blockedTask, shippedStep, blockedStep] = cardsFrom(detail);
    const pendingStep = { ...blockedStep, blocked: false, reason: '' };
    assert.deepEqual(holdActions(task), ['block']);
    assert.deepEqual(holdActions(pendingStep), ['block', 'drop']);
    assert.deepEqual(holdActions(blockedTask), []);
    assert.deepEqual(holdActions(blockedStep), []);
    assert.deepEqual(holdActions(shippedStep), []);
  });

  it('blocks a task through ws task, and blocks or drops a step through ws plan with the reason as its notes', () => {
    const [task, , , blockedStep] = cardsFrom(detail);
    const step = { ...blockedStep, blocked: false, reason: '' };
    assert.deepEqual(holdRequest(task, 'block', 'needs keys', 'alpha'), { path: 'desk/tasks/block', body: { project: 'alpha', id: 'task_a', reason: 'needs keys', revision: 'r1' } });
    assert.deepEqual(holdRequest(step, 'block', 'waits on API', 'alpha'), { path: 'desk/plan/status', body: { project: 'alpha', run: 'run-1', n: '2', status: 'blocked', notes: 'waits on API', revision: 'p1' } });
    assert.deepEqual(holdRequest(step, 'drop', 'superseded', 'alpha'), { path: 'desk/plan/status', body: { project: 'alpha', run: 'run-1', n: '2', status: 'dropped', notes: 'superseded', revision: 'p1' } });
  });

  it('frees a blocked task through ws task unblock and a blocked step by setting it pending', () => {
    const [, blockedTask, , blockedStep] = cardsFrom(detail);
    assert.deepEqual(releaseRequest(blockedTask, 'alpha'), { path: 'desk/tasks/unblock', body: { project: 'alpha', id: 'task_b', revision: 'r2' } });
    assert.deepEqual(releaseRequest(blockedStep, 'alpha'), { path: 'desk/plan/status', body: { project: 'alpha', run: 'run-1', n: '2', status: 'pending', revision: 'p1' } });
  });
});
