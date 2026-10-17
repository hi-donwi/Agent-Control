import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * Missions (Agent-Workspace ADR-0024): the Inbox in the menu and the Today view. `ws today`
 * and `ws alerts` are the stub's, answering with what each test writes to .local/stub/; the
 * real computation is the framework's and is tested there.
 */

const root = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const stub = (name: string) => join(root(), '.local', 'stub', name);

const LATE = {
  id: `overdue:${PROJECT}:task_late_report`, kind: 'overdue', severity: 'warn', scope: PROJECT, client: 'framework',
  title: 'Late report', detail: 'due 2026-10-15 (2 days ago)', ref: 'task_late_report', at: '2026-10-15',
};
const APPROVAL = {
  id: `approval:${PROJECT}:a1`, kind: 'approval', severity: 'attn', scope: PROJECT, client: 'framework',
  title: 'Approve run_command', detail: 'waiting 3 min', ref: 'a1', at: '2026-10-17T03:00:00Z',
};

function seed(): void {
  mkdirSync(join(root(), '.local', 'stub'), { recursive: true });
  writeFileSync(stub('alerts.json'), JSON.stringify({ alerts: [LATE] }));
  writeFileSync(stub('today.json'), JSON.stringify({
    date: '2026-10-17',
    signals: { overdue: 1, due_today: 0, waiting: 1, blocked: 0, stale: 0, review: 0, reminders: 0 },
    items: [APPROVAL, LATE],
    in_progress: [{ id: 'task_doing', title: 'Write the importer', scope: PROJECT, assignee: 'agent:claude' }],
  }));
  writeFileSync(stub('calls.log'), '');
}

test.beforeEach(seed);

test('the menu carries late work, and the Inbox snoozes an alert through ws alerts', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  const menu = page.getByRole('button', { name: /^Menu, .*1 due or late/ });
  await expect(menu).toBeVisible();
  await expect(page).toHaveTitle(/^\(\d+\) desk$/);

  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await drawer.getByRole('button', { name: /^Inbox/ }).click();
  const inbox = page.getByRole('dialog', { name: 'Inbox' });
  const late = inbox.getByRole('listitem', { name: 'overdue: Late report' });
  await expect(late).toContainText('due 2026-10-15 (2 days ago)');

  await late.getByRole('combobox', { name: 'Snooze Late report' }).selectOption('1d');
  await expect.poll(() => readFileSync(stub('calls.log'), 'utf-8')).toContain(`alerts snooze overdue:${PROJECT}:task_late_report --for 1d`);
  await expect(inbox.getByText('Nothing waits')).toBeVisible();
});

test('Today puts people waiting first, filters by signal, and opens the project room', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Today' }).click();

  const today = page.getByLabel('Today', { exact: true });
  await expect(today.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Floor position' })).toContainText('Today');
  const day = today.getByRole('region', { name: 'Your day' });
  await expect(day.getByRole('listitem')).toHaveText([/Approve run_command/, /Late report/]);
  await expect(today.getByRole('region', { name: 'In hand' })).toContainText('Write the importer');
  await expect(today.getByRole('region', { name: 'Client pulse' })).toContainText('framework');

  // A signal is a filter.
  await today.getByRole('button', { name: /overdue/ }).click();
  await expect(day.getByRole('listitem')).toHaveText([/Late report/]);

  // A task opens where it can be worked on: its project's room.
  await day.getByRole('listitem', { name: 'overdue: Late report' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByLabel(`Project room ${PROJECT}`).getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
});

test('Escape and the breadcrumb leave Today for the floor', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();

  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Today' }).click();
  await page.getByRole('navigation', { name: 'Floor position' }).getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();
});
