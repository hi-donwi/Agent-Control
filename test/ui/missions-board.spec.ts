import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * The Missions board and the task drawer (Agent-Workspace ADR-0024), against the stub's
 * task store: every change the page makes is a `ws task` command with the revision it read.
 */

const root = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const store = () => join(root(), '.local', 'stub', 'tasks.json');
const stored = () => (JSON.parse(readFileSync(store(), 'utf-8')) as { tasks: Array<Record<string, unknown>> }).tasks;

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
  writeFileSync(join(root(), '.local', 'stub', 'calls.log'), '');
  writeFileSync(store(), JSON.stringify({ tasks: [
    task('task_export_csv', { title: 'Export CSV', status: 'ready', priority: 'high', due: '2020-01-02', assignee: 'agent:claude',
      checklist: [{ n: 1, done: false, text: 'Parse rows' }], description: 'Monthly export for finance.' }),
    task('task_send_report', { title: 'Send the report', scope: '@framework', project: '', due: '2099-01-01' }),
    task('task_done_thing', { title: 'Old thing', status: 'done' }),
  ] }));
});

// The store answers only this spec's task commands; the others go back to the file stub.
test.afterAll(() => rmSync(store(), { force: true }));

async function openBoard(page: Page, deskUrl: string) {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Missions board' }).click();
  const board = page.getByLabel('Missions board', { exact: true });
  await expect(board.getByRole('heading', { level: 1, name: 'Missions board' })).toBeVisible();
  return board;
}

test('lays every client\'s work out by station, a lane per client', async ({ page, deskUrl }) => {
  const board = await openBoard(page, deskUrl);
  const lane = board.getByRole('region', { name: 'Lane framework' });
  await expect(lane).toContainText('2 open · 1 late');
  const ready = lane.getByRole('region', { name: 'framework, Ready for an agent' });
  await expect(ready.getByRole('button', { name: 'Task: Export CSV' })).toContainText('late');
  await expect(ready.getByRole('button', { name: 'Task: Export CSV' })).toContainText('0/1');
  await expect(lane.getByRole('region', { name: 'framework, Queue' })).toContainText('Send the report');
  await expect(lane.getByRole('region', { name: 'framework, Shipped' })).toContainText('Old thing');

  await board.getByRole('searchbox', { name: 'Search missions' }).fill('report');
  await expect(board.getByRole('button', { name: 'Task: Export CSV' })).toHaveCount(0);
  await expect(board.getByRole('button', { name: 'Task: Send the report' })).toBeVisible();
  await board.getByRole('searchbox', { name: 'Search missions' }).fill('');
  await board.getByRole('combobox', { name: 'Due' }).selectOption('late');
  await expect(board.getByRole('button', { name: /^Task: / })).toHaveCount(1);
});

test('the task drawer moves a task, comments, and works its checklist through ws task', async ({ page, deskUrl }) => {
  const board = await openBoard(page, deskUrl);
  await board.getByRole('button', { name: 'Task: Export CSV' }).click();
  const drawer = page.getByRole('dialog', { name: 'Task' });
  await expect(drawer.getByText('Monthly export for finance.')).toBeVisible();

  await drawer.getByRole('combobox', { name: 'Station' }).selectOption('in_progress');
  await expect.poll(() => stored()[0].status).toBe('in_progress');
  await expect(board.getByRole('region', { name: 'framework, In hands' }).getByRole('button', { name: 'Task: Export CSV' })).toBeVisible();

  // The checkbox follows the record: it ticks once ws has written the change.
  await drawer.getByRole('checkbox', { name: 'Parse rows' }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Parse rows' })).toBeChecked();
  await drawer.getByRole('textbox', { name: 'New checklist item' }).fill('Stream in batches');
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Stream in batches' })).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Comment' }).fill('Finance wants it by Friday');
  await drawer.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(drawer.getByRole('region', { name: 'Activity' })).toContainText('Finance wants it by Friday');
  const calls = readFileSync(join(root(), '.local', 'stub', 'calls.log'), 'utf-8');
  expect(calls).toContain(`task status ${PROJECT} task_export_csv in_progress --revision mtime:`);
  expect(calls).toContain(`task check ${PROJECT} task_export_csv 1 --revision mtime:`);
});

test('a change to a task that moved meanwhile is refused and the drawer reloads', async ({ page, deskUrl }) => {
  const board = await openBoard(page, deskUrl);
  await board.getByRole('button', { name: 'Task: Export CSV' }).click();
  const drawer = page.getByRole('dialog', { name: 'Task' });
  await expect(drawer.getByRole('combobox', { name: 'Priority' })).toHaveValue('high');
  // Someone else changes the task behind the drawer's back.
  const tasks = stored();
  tasks[0].revision = 'mtime:99:size:1';
  writeFileSync(store(), JSON.stringify({ tasks }));
  await drawer.getByRole('combobox', { name: 'Priority' }).selectOption('urgent');
  await expect(drawer.getByRole('alert')).toContainText('changed since it was shown');
  expect(stored()[0].priority).toBe('high');
});

test('a card dragged along its lane changes station', async ({ page, deskUrl }) => {
  const board = await openBoard(page, deskUrl);
  const card = board.getByRole('button', { name: 'Task: Send the report' });
  await card.dragTo(board.getByRole('region', { name: 'framework, Ready for an agent' }));
  await expect.poll(() => stored()[1].status).toBe('ready');
});

test('a quick mission goes to a project through ws task add', async ({ page, deskUrl }) => {
  const board = await openBoard(page, deskUrl);
  const add = board.getByRole('form', { name: 'New mission' });
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(add.getByRole('alert')).toContainText('a mission needs a title');
  await add.getByRole('textbox', { name: 'Mission title' }).fill('Board quick mission');
  await add.getByRole('combobox', { name: 'For' }).selectOption(PROJECT);
  await add.getByRole('button', { name: 'Add' }).click();
  await expect.poll(() => existsSync(join(root(), 'context', 'tasks', PROJECT, 'task_board_quick_mission.md'))).toBe(true);
});
