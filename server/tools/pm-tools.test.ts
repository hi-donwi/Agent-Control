import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmTools } from './pm-tools.js';
import type { WsInputRunner } from '../desk/ws-input.js';

/** A workspace with one project of client acme, and the operator's policy for it. */
function workspace(policy?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'ac-pm-tools-'));
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'context', 'registry.tsv'), 'key\tclient\tgroup\tfolder\napi\tacme\t-\tprojects/acme/api\n');
  mkdirSync(join(root, 'projects', 'acme', 'api'), { recursive: true });
  if (policy) {
    mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
    writeFileSync(join(root, '.local', 'agent', 'policies', 'api.json'), JSON.stringify({ schema_version: 1, ...policy }));
  }
  return root;
}

function fakeWs() {
  const calls: string[][] = [];
  const run: WsInputRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'task' && args[1] === 'list') return JSON.stringify({ tasks: [{ id: 'task_a', title: 'A', activity: [{ text: 'long history' }], revision: 'mtime:1:size:1' }] });
    if (args[0] === 'today') return JSON.stringify({ date: '2026-10-17', items: [] });
    if (args[0] === 'client') return JSON.stringify({ client: 'acme', restricted: { contacts: true } });
    return `task task_a backlog mtime:${calls.length}:size:1\n`;
  };
  return { run, calls };
}

const call = (tools: ReturnType<typeof pmTools>, name: string, args: Record<string, unknown> = {}) =>
  (tools[name].execute as (a: unknown) => Promise<Record<string, unknown>>)(args);

describe('project management tools in a project chat', () => {
  it('reads the project and its client\'s own work, nothing else, without the activity', async () => {
    const { run, calls } = fakeWs();
    const tools = pmTools({ root: workspace(), project: 'api', folder: 'projects/acme/api', remote: true }, run);
    const listed = await call(tools, 'list_tasks', { status: ['ready'] });
    assert.deepEqual(listed.tasks, [{ id: 'task_a', title: 'A', revision: 'mtime:1:size:1', scope: undefined, status: undefined, priority: undefined,
      kind: undefined, due: undefined, assignee: undefined, blocked: undefined, blocked_reason: undefined, checklist: undefined, labels: undefined }]);
    await call(tools, 'list_tasks', { scope: '@acme' });
    await assert.rejects(call(tools, 'list_tasks', { scope: 'other' }), /reaches api and @acme, not other/);
    await call(tools, 'today');
    assert.deepEqual((await call(tools, 'client_profile')).client, 'acme');
    assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['task', 'list', 'api'], ['task', 'list', '@acme'], ['today', '--json', '--scope'], ['client', 'show', 'acme']]);
  });

  it('refuses a change without an operator policy, and runs one the policy calls a change', async () => {
    const { run, calls } = fakeWs();
    const blocked = pmTools({ root: workspace(), project: 'api', folder: 'projects/acme/api', remote: true }, run);
    assert.match(String((await call(blocked, 'add_task', { title: 'From chat' })).error), /cannot classify this action/);
    assert.equal(calls.length, 0);

    const allowed = pmTools({ root: workspace({ default: 'read', actions: { task_change: 'change' } }), project: 'api', folder: 'projects/acme/api', remote: true }, run);
    await call(allowed, 'add_task', { title: 'From chat', due: '2026-10-30' });
    assert.deepEqual(calls[0], ['task', 'add', 'api', 'From chat', '--priority', 'normal', '--due', '2026-10-30', '-']);
  });

  it('updates a task in steps, each carrying the revision the step before it wrote', async () => {
    const { run, calls } = fakeWs();
    const tools = pmTools({ root: workspace({ default: 'change' }), project: 'api', folder: 'projects/acme/api', remote: true }, run);
    const result = await call(tools, 'update_task', { task_id: 'task_a', revision: 'mtime:1:size:1', check: 1, status: 'review', comment: 'Ready for a look' });
    assert.deepEqual(calls.map((c) => [c[1], c.at(-1)]), [['check', 'mtime:1:size:1'], ['status', 'mtime:1:size:1'], ['comment', 'mtime:2:size:1']]);
    assert.equal(result.revision, 'mtime:3:size:1');
  });
});
