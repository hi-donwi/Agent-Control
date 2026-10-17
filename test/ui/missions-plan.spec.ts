import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * The Backlog, the Timeline, and the client dossier (Agent-Workspace ADR-0024), against the
 * stub's task store and a dossier the spec writes. Dates are relative to today, so the
 * Timeline's week always holds them.
 */

const root = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const stubFile = (name: string) => join(root(), '.local', 'stub', name);
const stored = () => (JSON.parse(readFileSync(stubFile('tasks.json'), 'utf-8')) as { tasks: Array<Record<string, unknown>> }).tasks;

function localDay(offset = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Another day of this week (Monday to Sunday) than today. */
function otherDayThisWeek(): string {
  const weekday = (new Date().getDay() + 6) % 7; // Monday 0
  return localDay(weekday === 0 ? 1 : -1);
}

function task(id: string, fields: Record<string, unknown>) {
  return {
    id, title: id, scope: PROJECT, project: PROJECT, client: 'framework', status: 'backlog', priority: 'normal', kind: 'task', owner: 'dw',
    assignee: '', due: '', remind_at: '', recur: '', rank: 0, parent: '', depends_on: [], labels: [], acceptance_criteria: [],
    blocked: false, blocked_reason: '', description: '', checklist: [], activity: [], revision: 'mtime:1:size:1',
    updated_at: '2026-10-16T10:00:00+07:00', created_at: '2026-10-01T10:00:00+07:00', ...fields,
  };
}

test.beforeEach(() => {
  mkdirSync(join(root(), '.local', 'stub'), { recursive: true });
  writeFileSync(stubFile('calls.log'), '');
  writeFileSync(stubFile('tasks.json'), JSON.stringify({ tasks: [
    task('task_first', { title: 'First in line', rank: 1, due: localDay() }),
    task('task_second', { title: 'Second in line', rank: 2 }),
    task('task_third', { title: 'Third in line', rank: 3, due: '2020-01-02', parent: 'task_release' }),
    task('task_release', { title: 'Release one', kind: 'milestone', due: '2099-12-01', progress: { done: 1, total: 2 } }),
    task('task_call', { title: 'Call about phase 2', kind: 'reminder', scope: '@framework', project: '', remind_at: `${localDay()}T14:00+07:00`, due: localDay() }),
  ] }));
  writeFileSync(stubFile('client-framework.json'), JSON.stringify({
    client: 'framework', open: 3, overdue: 1, alerts: 2,
    profile: { title: 'framework - client', fields: { 'Full name': 'Framework Holdings' }, about: 'A fixture client.', working_agreement: 'Reports on Friday.', stakeholders: 'Head of IT decides.' },
    projects: [{ key: PROJECT, open: 3, overdue: 1 }],
    tasks: [task('task_call', { title: 'Call about phase 2', scope: '@framework', project: '' })],
    interactions: [{ at: '2026-10-16T10:00:00+07:00', actor: 'dw-desk', text: 'Kick-off call' }],
  }));
  writeFileSync(join(root(), 'context', 'clients', 'framework', 'contacts.md'), '| Ana | Head of IT | chat |\n');
});

test.afterAll(() => {
  rmSync(stubFile('tasks.json'), { force: true });
  rmSync(join(root(), 'context', 'clients', 'framework', 'contacts.md'), { force: true });
});

async function open(page: Page, deskUrl: string, entry: string) {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: entry, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: entry })).toBeVisible();
}

test('the backlog is ranked by hand, and a move rewrites only the ranks that change', async ({ page, deskUrl }) => {
  await open(page, deskUrl, 'Backlog');
  const group = page.getByRole('region', { name: 'Backlog framework' });
  await expect(group.getByRole('listitem')).toHaveText([/First in line/, /Second in line/, /Third in line/, /Call about phase 2/]);
  await expect(page.getByRole('region', { name: 'Milestones' }).getByRole('button', { name: 'Milestone: Release one' })).toContainText('1/2 done');

  await group.getByRole('button', { name: 'Move Third in line up' }).click();
  await expect.poll(() => stored().map((t) => [t.id, t.rank]).filter(([, rank]) => rank)).toEqual(
    // The whole group is numbered 1..n, so unranked work gets a place at the end.
    [['task_first', 1], ['task_second', 3], ['task_third', 2], ['task_call', 4]]);
  const calls = readFileSync(stubFile('calls.log'), 'utf-8');
  expect(calls).toContain(`task edit ${PROJECT} task_third --rank 2`);
  expect(calls).not.toContain('task_first --rank');
});

test('the timeline puts work on its day, late work earlier, and a drag moves the date', async ({ page, deskUrl }) => {
  await open(page, deskUrl, 'Timeline');
  const timeline = page.getByLabel('Timeline', { exact: true });
  const todayColumn = timeline.getByRole('region', { name: new RegExp(`${localDay()}$`) });
  await expect(todayColumn.getByRole('button', { name: 'Due: First in line' })).toBeVisible();
  await expect(todayColumn.getByRole('button', { name: 'Reminder: Call about phase 2' })).toContainText('14:00');
  await expect(timeline.getByRole('region', { name: 'Earlier, not done' })).toContainText('Third in line');

  const target = otherDayThisWeek();
  await todayColumn.getByRole('button', { name: 'Due: First in line' }).dragTo(timeline.getByRole('region', { name: new RegExp(`${target}$`) }));
  await expect.poll(() => stored()[0].due).toBe(target);
});

test('a client dossier shows the profile, work, and log, and the restricted records for the desk only', async ({ page, deskUrl }) => {
  await open(page, deskUrl, 'Clients');
  await page.getByRole('button', { name: 'Client framework' }).click();
  const dossier = page.getByLabel('Client framework', { exact: true });
  await expect(dossier.getByRole('heading', { level: 1, name: 'framework' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Floor position' })).toContainText('Clients');
  await expect(dossier).toContainText('Framework Holdings');
  await expect(dossier.getByRole('region', { name: 'Working with them' })).toContainText('Reports on Friday.');
  await expect(dossier.getByRole('region', { name: 'Their own work' })).toContainText('Call about phase 2');
  const contacts = dossier.getByRole('region', { name: 'Contacts' });
  await expect(contacts).toContainText('desk only');
  await expect(contacts).toContainText('Head of IT');

  await dossier.getByRole('textbox', { name: 'New interaction' }).fill('Call: agreed the phase 2 scope');
  await dossier.getByRole('button', { name: 'Log' }).click();
  await expect.poll(() => readFileSync(stubFile('calls.log'), 'utf-8')).toContain('client log framework Call: agreed the phase 2 scope');

  await dossier.getByRole('region', { name: 'Projects' }).getByRole('button', { name: PROJECT }).click();
  await expect(page.getByLabel(`Project room ${PROJECT}`).getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
});
