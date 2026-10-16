import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { HEAD_SHA, PROJECT, SESSION_BRANCH } from './workspace.js';
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

const workspaceRoot = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;

/** What `ws agent activity` or the Claude Code hooks write for an outside agent session. */
function reportActivity(root: string, session: string, state: string, detail: string): void {
  const dir = join(root, '.local', 'agent', 'activity');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${session}.json`), JSON.stringify({
    version: 1, session, project: PROJECT, tool: 'claude', state, detail, at: new Date().toISOString(),
  }));
}

test.beforeAll(() => seedApproval(workspaceRoot()));

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
  // The decision goes back into the conversation, so the agent continues without a retype.
  await expect(drawer.getByText(/^Approved request /).first()).toBeVisible();
  await expect(page.getByRole('button', { name: `agent-control in ${PROJECT}: idle, turn finished` }))
    .toBeVisible({ timeout: 10_000 });
});

test('moves an outside agent live as its activity record changes, with no reload', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  await page.goto(deskUrl);
  await expect(page.getByRole('status').filter({ hasText: 'Live.' })).toBeAttached();

  reportActivity(root, 'live-session', 'reading', 'Read');
  const seat = page.getByRole('button', { name: new RegExp(`^claude in ${PROJECT}: `) });
  await expect(seat).toHaveAccessibleName(`claude in ${PROJECT}: reading, Read`);

  reportActivity(root, 'live-session', 'waiting', 'Claude needs your permission to use Bash');
  await expect(seat).toHaveAccessibleName(`claude in ${PROJECT}: needs you, Claude needs your permission to use Bash`);

  // Its drawer says the chat there is this host's, not a line into that session.
  await seat.click();
  await expect(page.getByRole('dialog', { name: 'Assistant' }).getByText('Works in its own claude session')).toBeVisible();

  rmSync(join(root, '.local', 'agent', 'activity', 'live-session.json'));
  await expect(seat).toHaveCount(0);
});

test('keeps a project conversation across a reload', async ({ page, deskUrl }) => {
  const open = async () => {
    await page.getByRole('button', { name: 'Assistant' }).click();
    const drawer = page.getByRole('dialog', { name: 'Assistant' });
    await drawer.getByRole('combobox', { name: 'Assistant scope' }).selectOption(PROJECT);
    return drawer;
  };

  await page.goto(deskUrl);
  let drawer = await open();
  await expect(drawer.getByRole('combobox', { name: 'Model' })).toHaveValue('mock::echo');
  await drawer.locator('#chat-input').fill('persist me');
  await drawer.getByRole('button', { name: 'Send message' }).click();
  await expect(drawer.getByText('mock(echo): persist me')).toBeVisible();

  await page.reload();
  drawer = await open();
  await expect(drawer.getByText('mock(echo): persist me')).toBeVisible();
  await expect(drawer.getByText('persist me', { exact: true })).toBeVisible();

  // A new conversation starts empty; the old one stays in the history on disk.
  await drawer.getByRole('button', { name: 'New conversation' }).click();
  await expect(drawer.getByText('mock(echo): persist me')).toHaveCount(0);
});

test('lists the earlier conversations of a scope and continues one', async ({ page, deskUrl }) => {
  const open = async () => {
    await page.getByRole('button', { name: 'Assistant' }).click();
    const drawer = page.getByRole('dialog', { name: 'Assistant' });
    await drawer.getByRole('combobox', { name: 'Assistant scope' }).selectOption(PROJECT);
    await expect(drawer.getByRole('combobox', { name: 'Model' })).toHaveValue('mock::echo');
    return drawer;
  };
  const say = async (drawer: Locator, text: string) => {
    await drawer.locator('#chat-input').fill(text);
    await drawer.getByRole('button', { name: 'Send message' }).click();
    await expect(drawer.getByText(`mock(echo): ${text}`)).toBeVisible();
    // The answer is written to the history when the turn ends.
    await expect(drawer.getByRole('button', { name: 'Send message' })).toBeVisible();
  };

  await page.goto(deskUrl);
  let drawer = await open();
  await drawer.getByRole('button', { name: 'New conversation' }).click();
  await say(drawer, 'first topic');
  await drawer.getByRole('button', { name: 'New conversation' }).click();
  await say(drawer, 'second topic');

  await drawer.getByRole('button', { name: 'Earlier conversations' }).click();
  const list = drawer.getByRole('navigation', { name: 'Earlier conversations' });
  await expect(list.getByRole('button', { name: /^second topic/ })).toHaveAttribute('aria-current', 'true');
  await expect(list.getByRole('button', { name: /^first topic/ })).toContainText('2 messages');
  await list.getByRole('button', { name: /^first topic/ }).click();
  await expect(list).toHaveCount(0);
  await expect(drawer.getByText('mock(echo): first topic')).toBeVisible();
  await expect(drawer.getByText('mock(echo): second topic')).toHaveCount(0);

  // The next turn joins the conversation it continued, so a reload brings that one back.
  await say(drawer, 'more on the first');
  await page.reload();
  drawer = await open();
  await expect(drawer.getByText('mock(echo): first topic')).toBeVisible();
  await expect(drawer.getByText('mock(echo): more on the first')).toBeVisible();

  // The workspace scope lists none of this project's conversations.
  await drawer.getByRole('combobox', { name: 'Assistant scope' }).selectOption('');
  await drawer.getByRole('button', { name: 'Earlier conversations' }).click();
  await expect(drawer.getByRole('navigation', { name: 'Earlier conversations' }).getByText('first topic')).toHaveCount(0);
});

test('adds a note from the Notes section, written by ws note', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.locator('#desk-project').selectOption(PROJECT);
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Notes' }).click();
  const notes = page.getByRole('dialog', { name: 'Notes' });
  const title = notes.getByRole('textbox', { name: 'Title' });

  // Refused before anything runs, with the reason in the form.
  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(notes.getByText('a note needs a title')).toBeVisible();

  await title.fill('Desk note');
  await notes.getByRole('textbox', { name: 'Note' }).fill('Written from the desk.\nSecond line.');
  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(notes.locator('.section-doc').getByText('Desk note', { exact: true })).toBeVisible();
  await expect(title).toHaveValue('');

  // The host ran `ws note <key> <title> -` with the body on stdin; the stub wrote the file.
  const file = join(workspaceRoot(), 'context', 'memory', 'projects', PROJECT, 'notes', 'desk-note.md');
  expect(readFileSync(file, 'utf-8')).toContain('Written from the desk.\nSecond line.');
});

test('adds an operator task and moves it, through ws task', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.locator('#desk-project').selectOption(PROJECT);
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Tasks' }).click();
  const tasks = page.getByRole('dialog', { name: 'Tasks' });
  const doc = tasks.locator('.section-doc');

  await tasks.getByRole('textbox', { name: 'New task' }).fill('Ship the desk');
  await tasks.getByRole('button', { name: 'Add task' }).click();
  await expect(doc.getByText('Ship the desk', { exact: true })).toBeVisible();

  // The row's Start action sends its id and revision; the reloaded row shows the new status.
  await doc.getByRole('button', { name: 'Start' }).first().click();
  const file = join(workspaceRoot(), 'context', 'tasks', PROJECT, 'task_ship_the_desk.md');
  await expect.poll(() => readFileSync(file, 'utf-8')).toContain('status: in_progress');
  await expect(doc.getByText(/in.progress/i).first()).toBeVisible();
});

test('starts a run plan row from the Tasks section, through ws plan', async ({ page, deskUrl }) => {
  const run = '2026-10-16-090000-tester-desk-ship-it';
  const dir = join(workspaceRoot(), 'context', 'runs', PROJECT, run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), '# Ship it\n\n- **Owner:** tester (desk)\n');
  writeFileSync(join(dir, 'handoff.md'), '## State\n\n`in progress`\n');
  writeFileSync(join(dir, 'plan.md'), '| # | Task | Status | Notes |\n|---|---|---|---|\n| 1 | Write the parser | `pending` | |\n');

  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.locator('#desk-project').selectOption(PROJECT);
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Tasks' }).click();
  const plans = page.getByRole('dialog', { name: 'Tasks' }).locator('[data-node-id="tasks"]');
  await expect(plans.getByText('Write the parser', { exact: true })).toBeVisible();

  await plans.getByRole('button', { name: 'Start' }).first().click();
  await expect.poll(() => readFileSync(join(dir, 'plan.md'), 'utf-8')).toContain('| 1 | Write the parser | `in_progress` |');
  await expect(plans.getByText(/in.progress/i).first()).toBeVisible();
});

test('starts a coding session from the agent drawer and shows its changes', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: 'Assistant' }).click();
  const drawer = page.getByRole('dialog', { name: 'Assistant' });
  await drawer.getByRole('combobox', { name: 'Assistant scope' }).selectOption(PROJECT);
  const bar = drawer.getByRole('region', { name: 'Coding session' });

  // The bar appears once the session is known; the coding-session spec may have stopped it.
  await expect(bar).toBeVisible();
  const start = bar.getByRole('button', { name: 'Start coding session' });
  if (await start.isVisible()) await start.click();
  await expect(bar.getByText(SESSION_BRANCH)).toBeVisible();

  // What an agent's write_file would leave in the session's worktree.
  writeFileSync(join(workspaceRoot(), '.local', 'worktrees', PROJECT, 'NOTES.md'), '# Notes\nfrom the agent\n');
  await bar.getByRole('button', { name: 'Changes' }).click();
  const changes = drawer.getByLabel('Changes in the coding session');
  await expect(changes.getByText('NOTES.md')).toBeVisible();
  await expect(changes.getByText('from the agent')).toBeVisible();
});
