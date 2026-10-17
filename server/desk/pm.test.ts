import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PmConflictError, clientKeys, pmAddTask, pmLogInteraction, pmAlerts, pmBlock, pmCheck, pmClient, pmClients, pmComment, pmEditTask, pmRemind, pmSetStatus, pmTask, pmTasks, pmToday, snoozeAlert } from './pm.js';
import type { WsInputRunner } from './ws-input.js';

/** A `ws` that answers from `replies` by its first two words, and records every call. */
function fakeWs(replies: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  const run: WsInputRunner = async (args) => {
    calls.push(args);
    const reply = replies[`${args[0]} ${args[1]}`] ?? replies[args[0]] ?? {};
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  };
  return { run, calls };
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'ac-pm-'));
  for (const client of ['acme', 'beta']) mkdirSync(join(root, 'context', 'clients', client), { recursive: true });
  writeFileSync(join(root, 'context', 'clients', 'acme', 'client.md'), '# acme\n');
  writeFileSync(join(root, 'context', 'clients', 'acme', 'contacts.md'), '| Ana | PM | chat |\n');
  // beta has no client.md: not a client yet
  return root;
}

describe('desk project management reads', () => {
  it('asks ws today and ws alerts for JSON, with checked filters', async () => {
    const { run, calls } = fakeWs({ today: { date: '2026-10-17' }, alerts: { alerts: [] } });
    assert.deepEqual(await pmToday(run, { scope: '@acme', client: 'acme' }), { date: '2026-10-17' });
    await pmAlerts(run, true);
    assert.deepEqual(calls, [['today', '--json', '--scope', '@acme', '--client', 'acme'], ['alerts', '--json', '--all']]);
    await assert.rejects(pmToday(run, { scope: '../x' }), /invalid scope/);
  });

  it('lists tasks across every client, or one scope, with filters ws understands', async () => {
    const { run, calls } = fakeWs({ 'task list': { tasks: [{ id: 'task_a' }] } });
    assert.deepEqual(await pmTasks(run), { tasks: [{ id: 'task_a' }] });
    await pmTasks(run, { scope: 'api', status: ['ready', 'review'], assignee: 'agent:claude', label: 'export', kind: 'milestone', dueBefore: '2026-11-01', client: 'acme' });
    assert.deepEqual(calls[0], ['task', 'list', '--all', '--json']);
    assert.deepEqual(calls[1], ['task', 'list', 'api', '--json', '--client', 'acme', '--status', 'ready', '--status', 'review',
      '--assignee', 'agent:claude', '--label', 'export', '--kind', 'milestone', '--due-before', '2026-11-01']);
    await assert.rejects(pmTasks(run, { status: ['finished'] }), /unknown status/);
    await assert.rejects(pmTasks(run, { dueBefore: 'tomorrow' }), /invalid date/);
    await assert.rejects(pmTask(run, 'api', 'not-a-task'), /invalid task id/);
  });

  it('snoozes an alert by id for a length, or lifts it', async () => {
    const { run, calls } = fakeWs();
    await snoozeAlert(run, { id: 'overdue:@acme:task_report', for: '1d' });
    await snoozeAlert(run, { id: 'overdue:@acme:task_report', off: true });
    assert.deepEqual(calls, [['alerts', 'snooze', 'overdue:@acme:task_report', '--for', '1d'], ['alerts', 'snooze', 'overdue:@acme:task_report', '--off']]);
    await assert.rejects(snoozeAlert(run, { id: 'x; rm -rf', for: '1d' }), /invalid alert id/);
    await assert.rejects(snoozeAlert(run, { id: 'overdue:api:task_a', for: 'forever' }), /snooze for/);
  });

  it('reads a dossier through ws and, for the desk only, the restricted records from disk', async () => {
    const root = workspace();
    assert.deepEqual(clientKeys(root), ['acme']);
    const { run, calls } = fakeWs({ 'client show': { client: 'acme', open: 3, overdue: 1, alerts: 2, projects: [{ key: 'api' }],
      interactions: [{ at: '2026-10-16T10:00:00+07:00' }], profile: { fields: { 'Full name': 'Acme Logistics' } } } });
    const dossier = await pmClient(root, run, 'acme');
    assert.deepEqual(calls[0], ['client', 'show', 'acme', '--json']);
    assert.deepEqual(dossier.restrictedText, { contacts: '| Ana | PM | chat |\n', commercial: null });
    await assert.rejects(pmClient(root, run, '../../etc'), /invalid client/);
    const { clients } = await pmClients(root, run);
    assert.deepEqual(clients, [{ key: 'acme', name: 'Acme Logistics', projects: 1, open: 3, overdue: 1, alerts: 2, lastInteraction: '2026-10-16T10:00:00+07:00' }]);
  });
});

describe('desk project management writes', () => {
  const REV = 'mtime:1:size:2';
  /** A `ws` that prints the line every task write prints, and records what it was asked. */
  function writer(fail?: string) {
    const calls: Array<{ args: string[]; input: string }> = [];
    const run: WsInputRunner = async (args, input) => {
      calls.push({ args, input });
      if (fail) throw new Error(fail);
      return `task task_x ${args[1] === 'status' ? args[4] : 'backlog'} mtime:9:size:9\n`;
    };
    return { run, calls };
  }

  it('adds a task to a project or a client, the description on stdin', async () => {
    const { run, calls } = writer();
    assert.deepEqual(await pmAddTask(run, { scope: '@acme', title: '  Send   the report ', priority: 'high', due: '2026-10-31',
      assignee: 'agent:claude', labels: ['report'], kind: 'task', description: 'Monthly.' }), { id: 'task_x', status: 'backlog', revision: 'mtime:9:size:9' });
    assert.deepEqual(calls[0], { args: ['task', 'add', '@acme', 'Send the report', '--priority', 'high', '--due', '2026-10-31',
      '--assignee', 'agent:claude', '--label', 'report', '--kind', 'task', '-'], input: 'Monthly.' });
    await assert.rejects(pmAddTask(run, { scope: 'api', title: '' }), /the title is empty/);
    await assert.rejects(pmAddTask(run, { scope: 'api', title: 'x', due: '31/10' }), /YYYY-MM-DD/);
    await assert.rejects(pmAddTask(run, { scope: 'api', title: 'x', labels: ['Bad Label'] }), /invalid label/);
  });

  it('edits fields, clears with none, and carries the revision', async () => {
    const { run, calls } = writer();
    await pmEditTask(run, { scope: 'api', id: 'task_x', revision: REV, changes: { due: 'none', priority: 'urgent', labels_add: ['export'], check_add: ['Parse rows'], rank: 2 } });
    assert.deepEqual(calls[0].args, ['task', 'edit', 'api', 'task_x', '--priority', 'urgent', '--due', 'none', '--rank', '2',
      '--label-add', 'export', '--check-add', 'Parse rows', '--revision', REV]);
    await assert.rejects(pmEditTask(run, { scope: 'api', id: 'task_x', changes: {} }), /nothing to change/);
    await assert.rejects(pmEditTask(run, { scope: 'api', id: 'task_x', changes: { title: 'none' } }), /invalid title/);
    await assert.rejects(pmEditTask(run, { scope: 'api', id: 'task_x', revision: 'stale', changes: { due: 'none' } }), /reload the task/);
  });

  it('moves, comments, checks, blocks, and reminds through ws', async () => {
    const { run, calls } = writer();
    assert.equal((await pmSetStatus(run, { scope: 'api', id: 'task_x', status: 'review', revision: REV })).status, 'review');
    await pmComment(run, { scope: 'api', id: 'task_x', text: 'Looks good' });
    await pmCheck(run, { scope: 'api', id: 'task_x', n: 2 });
    await pmBlock(run, { scope: 'api', id: 'task_x', reason: 'waits on DB access' }, true);
    await pmBlock(run, { scope: 'api', id: 'task_x' }, false);
    await pmRemind(run, { scope: '@acme', text: 'Call about phase 2', at: '2026-10-20T14:00', recur: 'weekly' });
    assert.deepEqual(calls.map((c) => c.args), [
      ['task', 'status', 'api', 'task_x', 'review', '--revision', REV],
      ['task', 'comment', 'api', 'task_x', 'Looks good'],
      ['task', 'check', 'api', 'task_x', '2'],
      ['task', 'block', 'api', 'task_x', 'waits on DB access'],
      ['task', 'unblock', 'api', 'task_x'],
      ['remind', '@acme', 'Call about phase 2', '--at', '2026-10-20 14:00', '--recur', 'weekly'],
    ]);
    await assert.rejects(pmSetStatus(run, { scope: 'api', id: 'task_x', status: 'finished' }), /unknown status/);
    await assert.rejects(pmCheck(run, { scope: 'api', id: 'task_x', n: 0 }), /a number, from 1/);
    await assert.rejects(pmRemind(run, { scope: 'api', text: 'x', at: 'tomorrow' }), /needs a time/);
  });

  it('turns a revision mismatch into a conflict the desk reloads on', async () => {
    const { run } = writer('workspace tasks: revision mismatch: the task changed since it was read');
    await assert.rejects(pmSetStatus(run, { scope: 'api', id: 'task_x', status: 'done', revision: REV }), PmConflictError);
  });
});

describe('client interaction log', () => {
  it('appends one line through ws client log, checked first', async () => {
    const calls: string[][] = [];
    const run: WsInputRunner = async (args) => { calls.push(args); return 'logged acme\n'; };
    assert.deepEqual(await pmLogInteraction(run, 'acme', { text: 'Call:  agreed   phase 2' }), { client: 'acme' });
    assert.deepEqual(calls, [['client', 'log', 'acme', 'Call: agreed phase 2']]);
    await assert.rejects(pmLogInteraction(run, 'acme', { text: ' ' }), /the entry is empty/);
    await assert.rejects(pmLogInteraction(run, '../x', { text: 'x' }), /invalid client/);
  });
});
