import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientKeys, pmAlerts, pmClient, pmClients, pmTask, pmTasks, pmToday, snoozeAlert } from './pm.js';
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
