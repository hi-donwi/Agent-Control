import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cardsAt, dueTone, filterTasks, lanesOf } from './board';
import type { PmTask } from './types';

function task(id: string, fields: Partial<PmTask> = {}): PmTask {
  return {
    id, title: id, scope: 'api', project: 'api', client: 'acme', status: 'backlog', priority: 'normal', kind: 'task', owner: 'dw',
    assignee: '', due: '', remind_at: '', recur: '', rank: 0, parent: '', depends_on: [], labels: [], acceptance_criteria: [],
    blocked: false, blocked_reason: '', description: '', checklist: [], activity: [], revision: 'r', updated_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', ...fields,
  };
}

const TODAY = '2026-10-17';

describe('missions board', () => {
  it('reads a due date as late, today, or soon, and says nothing of done work', () => {
    assert.equal(dueTone(task('a', { due: '2026-10-16' }), TODAY), 'late');
    assert.equal(dueTone(task('a', { due: TODAY }), TODAY), 'today');
    assert.equal(dueTone(task('a', { due: '2026-10-24' }), TODAY), 'soon');
    assert.equal(dueTone(task('a', { due: '2026-10-25' }), TODAY), '');
    assert.equal(dueTone(task('a', { due: '2026-10-01', status: 'done' }), TODAY), '');
  });

  it('filters by client, assignee, label, text, and due', () => {
    const tasks = [
      task('task_a', { client: 'acme', assignee: 'agent:claude', labels: ['export'], due: '2026-10-10' }),
      task('task_b', { client: 'beta', title: 'Landing copy', due: '2026-10-20' }),
      task('task_c', { client: 'beta' }),
    ];
    assert.deepEqual(filterTasks(tasks, { client: 'beta' }, TODAY).map((t) => t.id), ['task_b', 'task_c']);
    assert.deepEqual(filterTasks(tasks, { assignee: 'agent:claude' }, TODAY).map((t) => t.id), ['task_a']);
    assert.deepEqual(filterTasks(tasks, { label: 'export' }, TODAY).map((t) => t.id), ['task_a']);
    assert.deepEqual(filterTasks(tasks, { query: 'landing' }, TODAY).map((t) => t.id), ['task_b']);
    assert.deepEqual(filterTasks(tasks, { due: 'late' }, TODAY).map((t) => t.id), ['task_a']);
    assert.deepEqual(filterTasks(tasks, { due: 'week' }, TODAY).map((t) => t.id), ['task_a', 'task_b']);
  });

  it('groups lanes by client with counts, the unnamed lane last', () => {
    const tasks = [task('a', { client: 'beta' }), task('b', { client: 'acme', due: '2026-10-01' }), task('c', { client: '' }), task('d', { client: 'acme', status: 'done' })];
    assert.deepEqual(lanesOf(tasks, 'client', TODAY).map((l) => [l.label, l.open, l.overdue]), [['acme', 1, 1], ['beta', 1, 0], ['no client', 1, 0]]);
    assert.deepEqual(lanesOf(tasks, 'assignee', TODAY).map((l) => l.label), ['unassigned']);
  });

  it('orders a station by rank then due date, and shows only the newest shipped work', () => {
    const lane = lanesOf([
      task('task_late', { due: '2026-10-30' }), task('task_soon', { due: '2026-10-18' }), task('task_first', { rank: 1 }),
      ...Array.from({ length: 8 }, (_, i) => task(`task_done_${i}`, { status: 'done', updated_at: `2026-10-0${i + 1}T00:00:00Z` })),
    ], 'client', TODAY)[0];
    assert.deepEqual(cardsAt(lane, 'queue').map((t) => t.id), ['task_first', 'task_soon', 'task_late']);
    assert.deepEqual(cardsAt(lane, 'shipped', 3).map((t) => t.id), ['task_done_7', 'task_done_6', 'task_done_5']);
  });
});
