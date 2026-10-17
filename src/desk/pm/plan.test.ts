import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backlogGroups, milestones, reorder, timeline, weekOf } from './plan';
import type { PmTask } from './types';

function task(id: string, fields: Partial<PmTask> = {}): PmTask {
  return {
    id, title: id, scope: 'api', project: 'api', client: 'acme', status: 'backlog', priority: 'normal', kind: 'task', owner: 'dw',
    assignee: '', due: '', remind_at: '', recur: '', rank: 0, parent: '', depends_on: [], labels: [], acceptance_criteria: [],
    blocked: false, blocked_reason: '', description: '', checklist: [], activity: [], revision: 'r', updated_at: '', created_at: '', ...fields,
  };
}

describe('backlog and timeline', () => {
  it('groups open work by client or milestone, ranked, milestones and done work left out', () => {
    const tasks = [
      task('task_b', { client: 'beta', rank: 2 }), task('task_a', { client: 'beta', rank: 1 }), task('task_c', { client: 'acme', due: '2026-10-20' }),
      task('task_m', { kind: 'milestone', title: 'Release 1' }), task('task_x', { parent: 'task_m' }), task('task_done', { status: 'done' }),
    ];
    assert.deepEqual(backlogGroups(tasks, 'client').map((g) => [g.label, g.tasks.map((t) => t.id)]),
      [['acme', ['task_c', 'task_x']], ['beta', ['task_a', 'task_b']]]);
    assert.deepEqual(backlogGroups(tasks, 'milestone').map((g) => g.label), ['Release 1', 'no milestone']);
    assert.deepEqual(milestones(tasks).map((t) => t.id), ['task_m']);
  });

  it('renumbers a group to put a task where it was dropped, writing only what changes', () => {
    const group = [task('a', { rank: 1 }), task('b', { rank: 2 }), task('c', { rank: 3 })];
    assert.deepEqual(reorder(group, 'c', 0).map(({ task: t, rank }) => [t.id, rank]), [['c', 1], ['a', 2], ['b', 3]]);
    assert.deepEqual(reorder(group, 'a', 1).map(({ task: t, rank }) => [t.id, rank]), [['b', 1], ['a', 2]]);
    assert.deepEqual(reorder(group, 'b', 1), []);
  });

  it('lays a week out from Monday, with reminders on their day and late work earlier', () => {
    const days = weekOf('2026-10-17');
    assert.deepEqual([days[0], days[6]], ['2026-10-12', '2026-10-18']);
    const placed = timeline([
      task('task_due', { due: '2026-10-14' }), task('task_call', { kind: 'reminder', remind_at: '2026-10-16T14:00+07:00', due: '2026-10-16' }),
      task('task_late', { due: '2026-10-01' }), task('task_old_done', { due: '2026-10-01', status: 'done' }), task('task_none'),
    ], days);
    assert.deepEqual(placed.days['2026-10-14'].map((t) => t.id), ['task_due']);
    assert.deepEqual(placed.days['2026-10-16'].map((t) => t.id), ['task_call']);
    assert.deepEqual(placed.earlier.map((t) => t.id), ['task_late']);
  });
});
