import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskConflictError, addTask, setTaskStatus } from './tasks.js';
import { readCollection, taskFields } from './collections.js';
import type { WsInputRunner } from './ws-input.js';
import type { Floor } from './floor.js';

const REV = 'mtime:1792160000000000000:size:420';

function recorder(output: string) {
  const calls: string[][] = [];
  const run: WsInputRunner = async (args) => { calls.push(args); return output; };
  return { calls, run };
}

describe('addTask', () => {
  it('runs ws task add with the priority and returns what it reported', async () => {
    const { calls, run } = recorder(`\u001b[0mtask task_write_export backlog ${REV}\n`);
    assert.deepEqual(await addTask(run, { project: 'alpha', title: ' Write  export ', priority: 'high' }), {
      id: 'task_write_export', status: 'backlog', revision: REV,
    });
    assert.deepEqual(calls, [['task', 'add', 'alpha', 'Write export', '--priority', 'high', '-']]);
  });

  it('refuses before running ws', async () => {
    const { calls, run } = recorder('');
    await assert.rejects(addTask(run, { project: '../x', title: 't' }), /choose a project/);
    await assert.rejects(addTask(run, { project: 'alpha', title: '  ' }), /needs a title/);
    await assert.rejects(addTask(run, { project: 'alpha', title: 't', priority: 'extreme' }), /unknown priority/);
    assert.equal(calls.length, 0);
  });
});

describe('setTaskStatus', () => {
  it('sends the revision it was given', async () => {
    const { calls, run } = recorder(`task task_a in_progress ${REV}\n`);
    await setTaskStatus(run, { project: 'alpha', id: 'task_a', status: 'in_progress', revision: REV });
    assert.deepEqual(calls, [['task', 'status', 'alpha', 'task_a', 'in_progress', '--revision', REV]]);
  });

  it('requires a revision, a known status, and a task id', async () => {
    const { run } = recorder('');
    await assert.rejects(setTaskStatus(run, { project: 'alpha', id: 'task_a', status: 'done' }), /reload/);
    await assert.rejects(setTaskStatus(run, { project: 'alpha', id: 'task_a', status: 'finished', revision: REV }), /unknown status/);
    await assert.rejects(setTaskStatus(run, { project: 'alpha', id: 'x', status: 'done', revision: REV }), /choose a task/);
  });

  it('turns a revision mismatch into a conflict', async () => {
    const run: WsInputRunner = async () => { throw new Error('workspace tasks: revision mismatch: the task changed since it was read'); };
    await assert.rejects(setTaskStatus(run, { project: 'alpha', id: 'task_a', status: 'done', revision: REV }), TaskConflictError);
  });
});

describe('backlog collection', () => {
  let root: string;
  const floor: Floor = { generatedAt: '', zones: [], totals: { projects: 0, agents: 0, active: 0, waiting: 0 } };
  const task = (id: string, status: string, updated: string) => [
    '---', 'schema_version: 1', `id: ${id}`, 'project: alpha', `title: Title of ${id}: with a colon`,
    `status: ${status}`, 'priority: high', 'owner: dev', 'labels:', `created_at: ${updated}`, `updated_at: ${updated}`, '---', '',
  ].join('\n');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ac-tasks-'));
    mkdirSync(join(root, 'context', 'tasks', 'alpha'), { recursive: true });
    writeFileSync(join(root, 'context', 'tasks', 'alpha', 'task_a.md'), task('task_a', 'done', '2026-10-16T10:00:00+07:00'));
    writeFileSync(join(root, 'context', 'tasks', 'alpha', 'task_b.md'), task('task_b', 'in_progress', '2026-10-16T09:00:00+07:00'));
    writeFileSync(join(root, 'context', 'tasks', 'alpha', 'task_c.md'), task('task_c', 'backlog', '2026-10-16T11:00:00+07:00').replace('project: alpha', 'project: beta'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the front matter, keeps colons in titles, and ignores a task of another project', () => {
    assert.equal(taskFields(task('task_a', 'done', 'x')).title, 'Title of task_a: with a colon');
    const rows = readCollection(root, 'backlog', 'alpha', floor);
    assert.deepEqual(rows.map((r) => [r.id, r.status]), [['task_b', 'in_progress'], ['task_a', 'done']]);
  });

  it('gives each row the revision ws_tasks.py computes', () => {
    const path = join(root, 'context', 'tasks', 'alpha', 'task_a.md');
    const stat = statSync(path, { bigint: true });
    const row = readCollection(root, 'backlog', 'alpha', floor).find((r) => r.id === 'task_a')!;
    assert.equal(row.revision, `mtime:${stat.mtimeNs}:size:${stat.size}`);
  });
});
