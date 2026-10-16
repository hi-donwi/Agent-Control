import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { HEAD_SHA, PROJECT } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * The desk: the floor, the menu drawer with a UIDL section, and the agent drawer. Whether
 * the approvals spec already decided the seeded request depends on which specs run, so
 * this one raises its own hand with a fresh request and asserts nothing about the rest.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function seedApproval(root: string): void {
  const now = Date.now();
  const event = {
    type: 'requested',
    id: REQUEST_ID,
    project: PROJECT,
    headSha: HEAD_SHA,
    action: 'write_file',
    inputHash: 'f'.repeat(64),
    policyHash: 'e'.repeat(64),
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  };
  const file = join(root, '.local', 'agent', 'approvals', PROJECT, `${new Date(now).toISOString().slice(0, 7)}.jsonl`);
  appendFileSync(file, JSON.stringify(event) + '\n');
}

test.beforeAll(() => seedApproval((JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root));

test('shows each project as a room, with the host agent raising its hand', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);

  const room = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(room).toBeVisible();
  await expect(room.getByText('session')).toBeVisible();
  await expect(room.getByRole('button', { name: new RegExp(`^agent-control in ${PROJECT}: needs you, approval: `) })).toBeVisible();

  // The only chrome: two icons, and the menu carries the waiting count.
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu, 1 waiting for you' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 waiting for you' })).toBeVisible();
});

test('renders a menu section as a UIDL document read through the desk adapter', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();

  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('button', { name: /Projects/ }).click();
  const projects = page.getByRole('dialog', { name: 'Projects' });
  // uidl-runtime 0.1.4's DataTable lays rows out as text, not table cells.
  await expect(projects.locator('.section-doc').getByText(PROJECT, { exact: true })).toBeVisible();

  await projects.getByRole('button', { name: 'Back to menu' }).click();
  await page.locator('#desk-project').selectOption(PROJECT);
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Runs' }).click();
  await expect(page.getByRole('dialog', { name: 'Runs' }).getByText('No runs yet. Start one with ws run.')).toBeVisible();
});

test('opens the agent drawer bound to its project: approval, chat, and a live pose', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: new RegExp(`^agent-control in ${PROJECT}`) }).click();

  const drawer = page.getByRole('dialog', { name: 'Assistant' });
  await expect(drawer.getByRole('heading', { name: `Assistant · ${PROJECT}` })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Agent agent-control' }).getByText('needs you')).toBeVisible();

  // Only the local mock is allowed for this project (its policy lists no remote endpoint).
  await expect(drawer.getByRole('combobox', { name: 'Model' })).toHaveValue('mock::echo');
  await drawer.locator('#chat-input').fill('hello');
  await drawer.getByRole('button', { name: 'Send message' }).click();
  await expect(drawer.getByText('mock(echo): hello')).toBeVisible();

  // Approving every request once clears the hand; the next poll shows the host idle after its turn.
  const waiting = drawer.getByRole('region', { name: 'Waiting for you' });
  await expect(waiting.getByText('write_file')).toBeVisible();
  const approve = waiting.getByRole('button', { name: 'Approve once' });
  for (let left = await approve.count(); left > 0; left--) {
    await approve.first().click();
    await expect(approve).toHaveCount(left - 1);
  }
  await expect(waiting).toHaveCount(0);
  await expect(page.getByRole('button', { name: `agent-control in ${PROJECT}: idle, turn finished` }))
    .toBeVisible({ timeout: 10_000 });
});
