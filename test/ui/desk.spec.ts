import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { addFanoutProject, FANOUT_PROJECT, HEAD_SHA, PROJECT, removeFanoutProject, SESSION_BRANCH, worktreeOf } from './workspace.js';
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

test.afterEach(() => removeFanoutProject(workspaceRoot()));

async function selectProjectCommandTarget(page: Page): Promise<void> {
  const target = page.getByRole('combobox', { name: 'Command target' });
  const targetPrefix = `agent-control · ${PROJECT}`;
  const hostOption = target.locator('option').filter({ hasText: targetPrefix });
  await expect(hostOption).toHaveCount(1);
  await target.selectOption(await hostOption.getAttribute('value') ?? '');
}

async function mockCommandTool(page: Page, toolName: string, args: Record<string, unknown>, result: unknown): Promise<void> {
  await page.route('**/api/agent/chat', async (route) => {
    const request = route.request().postDataJSON() as { project?: string };
    expect(request.project).toBe(PROJECT);
    const toolCallId = 'call-evidence-action';
    const body = [
      `9:${JSON.stringify({ toolCallId, toolName, args })}`,
      `a:${JSON.stringify({ toolCallId, result })}`,
      `0:${JSON.stringify('Evidence is ready.')}`,
      `d:${JSON.stringify({ finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } })}`,
      '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body });
  });
}

async function sendCommandAndInspectEvidence(page: Page): Promise<void> {
  await selectProjectCommandTarget(page);
  await page.locator('#command-dock-input').fill('Inspect the referenced record');
  await page.getByRole('button', { name: 'Send command' }).click();
  await page.getByRole('button', { name: 'Inspect evidence' }).click();
  await expect(page.getByRole('region', { name: 'Response evidence' })).toBeVisible();
  const popover = page.getByRole('complementary', { name: `Response from agent-control in ${PROJECT}` });
  const bounds = await popover.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
}

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

test('opens a completed task reference from read-only command evidence', async ({ page, deskUrl }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCommandTool(page, 'list_tasks', {}, {
    tasks: [{ id: 'task_evidence_link', scope: PROJECT, title: 'Evidence task' }],
  });
  await page.route(`**/api/agent/desk/pm/tasks/${PROJECT}/task_evidence_link`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'task_evidence_link', title: 'Evidence task', scope: PROJECT, project: PROJECT, client: 'workspace',
      status: 'ready', priority: 'normal', kind: 'task', owner: '', assignee: '', due: '', remind_at: '', recur: '',
      rank: 1, parent: '', depends_on: [], labels: [], acceptance_criteria: [], blocked: false, blocked_reason: '',
      description: '', checklist: [], activity: [], revision: 'mtime:1:size:1', updated_at: '', created_at: '',
    }),
  }));

  await page.goto(deskUrl);
  await sendCommandAndInspectEvidence(page);
  await page.getByRole('button', { name: 'Open task task_evidence_link' }).click();

  const drawer = page.getByRole('dialog', { name: 'Task' });
  await expect(drawer.getByRole('heading', { name: `Evidence task · ${PROJECT}` })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close task' }).click();
  await expect(page.getByRole('button', { name: 'Open task task_evidence_link' })).toBeFocused();
});

test('opens the matching approval for review without deciding it from evidence', async ({ page, deskUrl }) => {
  const approvalId = '123e4567-e89b-12d3-a456-426614174000';
  await mockCommandTool(page, 'update_task', {}, { approvalRequired: true, requestId: approvalId });
  await page.route(`**/api/agent/approvals?project=${PROJECT}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ pending: [{
      id: approvalId, project: PROJECT, headSha: 'a'.repeat(40), action: 'task_change', inputHash: 'b'.repeat(64),
      policyHash: 'c'.repeat(64), requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }] }),
  }));

  await page.goto(deskUrl);
  await sendCommandAndInspectEvidence(page);
  await page.getByRole('button', { name: `Review approval ${approvalId.slice(0, 8)}` }).click();

  const drawer = page.getByRole('dialog', { name: 'Assistant' });
  const approval = drawer.getByText('Referenced from response evidence');
  await expect(approval).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Approve once' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Deny' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close assistant' }).click();
  await expect(page.getByRole('button', { name: `Review approval ${approvalId.slice(0, 8)}` })).toBeFocused();
});

test('opens a non-empty diff reference in the same project Changes tab', async ({ page, deskUrl }) => {
  const worktree = worktreeOf(workspaceRoot());
  writeFileSync(join(worktree, 'README.md'), '# Updated in the coding worktree\n');
  await mockCommandTool(page, 'git_diff', {}, {
    content: 'diff --git a/README.md b/README.md\n+Updated in the coding worktree',
  });

  await page.goto(deskUrl);
  await sendCommandAndInspectEvidence(page);
  const evidence = page.getByRole('region', { name: 'Response evidence' });
  await expect(evidence.getByRole('button', { name: 'Open diff' })).toBeVisible();
  await expect(evidence).not.toContainText('Updated in the coding worktree');
  await evidence.getByRole('button', { name: 'Open diff' }).click();

  const drawer = page.getByRole('dialog', { name: 'Assistant' });
  await expect(drawer.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByLabel('Changes in the coding session')).toContainText('README.md');
  await drawer.getByRole('button', { name: 'Close assistant' }).click();
  await expect(evidence.getByRole('button', { name: 'Open diff' })).toBeFocused();
});

test('compares the current response with a selected earlier response in the same project chat', async ({ page, deskUrl }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let turn = 0;
  await page.route('**/api/agent/chat', async (route) => {
    const request = route.request().postDataJSON() as { project?: string };
    expect(request.project).toBe(PROJECT);
    const response = turn++ === 0 ? 'Earlier response for this project.' : 'Current response for this project.';
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: `0:${JSON.stringify(response)}\nd:${JSON.stringify({ finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } })}\n`,
    });
  });
  await page.route(/\/api\/agent\/conversations\/latest\?scope=mockproj$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: null, messages: [] }),
  }));

  await page.goto(deskUrl);
  await selectProjectCommandTarget(page);
  const composer = page.locator('#command-dock-input');
  await composer.fill('First project response');
  await page.getByRole('button', { name: 'Send command' }).click();
  await expect(page.getByText('Earlier response for this project.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare responses' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss response preview' }).click();

  await composer.fill('Second project response');
  await page.getByRole('button', { name: 'Send command' }).click();
  await page.getByRole('button', { name: 'Compare responses' }).click();

  const comparison = page.getByRole('dialog', { name: `Compare responses · ${PROJECT}` });
  const current = comparison.getByRole('article', { name: 'Current response' });
  const earlier = comparison.getByRole('article', { name: 'Selected earlier response' });
  await expect(current).toContainText('Current response for this project.');
  await expect(earlier).toContainText('Earlier response for this project.');
  await expect(current).toBeVisible();
  await expect(earlier).toBeVisible();
  await expect(comparison.getByRole('combobox', { name: 'Compare current response with' })).toBeVisible();
  const currentBounds = await current.boundingBox();
  const earlierBounds = await earlier.boundingBox();
  expect(currentBounds).not.toBeNull();
  expect(earlierBounds).not.toBeNull();
  expect(currentBounds!.width).toBeGreaterThan(0);
  expect(earlierBounds!.width).toBeGreaterThan(0);
  expect(currentBounds!.y).toBeLessThan(earlierBounds!.y);
  await comparison.getByRole('button', { name: 'Close comparison' }).click();
  await expect(page.getByRole('button', { name: 'Compare responses' })).toBeFocused();
});

test('fans out the same prompt to selected projects with separate conversations and responses', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  addFanoutProject(root);
  const conversationIds = {
    [PROJECT]: '66666666-6666-4666-8666-666666666666',
    [FANOUT_PROJECT]: '77777777-7777-4777-8777-777777777777',
  };
  const requests: Array<{ project: string; conversation: string; provider: string; messages: Array<{ content: string }> }> = [];
  const latestScopes: string[] = [];
  let projectLatestCount = 0;
  const staleProjectLoad: { release?: () => void } = {};
  await page.route(/\/api\/agent\/conversations\/latest\?scope=(mockproj|mockpeer)$/, async (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope') ?? '';
    latestScopes.push(scope);
    if (scope === PROJECT && projectLatestCount++ === 0) {
      await new Promise<void>((resolve) => { staleProjectLoad.release = resolve; });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: conversationIds[scope as keyof typeof conversationIds] ?? null, messages: [] }),
    });
  });
  await page.route('**/api/agent/chat', async (route) => {
    const request = route.request().postDataJSON() as {
      project: string;
      conversation: string;
      provider: string;
      messages: Array<{ content: string }>;
    };
    requests.push(request);
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: `0:${JSON.stringify(`Response from ${request.project}`)}\nd:${JSON.stringify({ finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } })}\n`,
    });
  });

  await page.goto(deskUrl);
  await selectProjectCommandTarget(page);
  await page.getByText(/^Send to multiple projects/).click();
  await expect(page.getByText('Each selected project receives the same prompt in its own scoped conversation.')).toBeVisible();
  await page.getByRole('checkbox', { name: `Send to ${PROJECT}` }).check();
  await page.getByRole('checkbox', { name: `Send to ${FANOUT_PROJECT}` }).check();
  await page.locator('#command-dock-input').fill('Summarize each selected project');
  await expect(page.getByRole('button', { name: 'Send to selected projects' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send to selected projects' }).click();

  await expect.poll(() => requests.length).toBe(2);
  expect(new Set(latestScopes)).toEqual(new Set([PROJECT, FANOUT_PROJECT]));
  expect(latestScopes.filter((scope) => scope === PROJECT)).toHaveLength(2);
  expect(requests.map((request) => request.project).sort()).toEqual([PROJECT, FANOUT_PROJECT].sort());
  expect(Object.fromEntries(requests.map((request) => [request.project, request.conversation]))).toEqual(conversationIds);
  expect(requests.every((request) => request.provider === 'mock')).toBe(true);
  expect(requests.every((request) => request.messages.at(-1)?.content === 'Summarize each selected project')).toBe(true);
  const projectResponse = page.getByRole('complementary', { name: `Response from agent-control in ${PROJECT}` });
  const peerResponse = page.getByRole('complementary', { name: `Response from agent-control in ${FANOUT_PROJECT}` });
  await expect(projectResponse).toContainText(`Response from ${PROJECT}`);
  await expect(peerResponse).toHaveCount(0);
  const projectBounds = await projectResponse.boundingBox();
  const viewport = page.viewportSize();
  expect(projectBounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(projectBounds!.x + projectBounds!.width).toBeLessThanOrEqual(viewport!.width);

  expect(staleProjectLoad.release).toBeTruthy();
  staleProjectLoad.release?.();
  await projectResponse
    .getByRole('button', { name: 'Open conversation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Assistant' });
  await expect(drawer.getByText('This project is selected for fan-out. Clear project recipients to chat with it individually.')).toBeVisible();
  await expect(drawer.getByText(`Response from ${PROJECT}`)).toBeVisible();
  await expect(drawer.locator('#chat-input')).toBeDisabled();
  await drawer.getByRole('button', { name: 'Close assistant' }).click();
  await expect(projectResponse.getByRole('button', { name: 'Open conversation' })).toBeFocused();
  await projectResponse.getByRole('button', { name: 'Dismiss response preview' }).click();
  await page.getByRole('list', { name: 'Project response statuses' })
    .getByRole('button', { name: `View response from ${FANOUT_PROJECT}` }).click();
  await expect(peerResponse).toContainText(`Response from ${FANOUT_PROJECT}`);
});

test('keeps a completed response from cancelling other fan-out recipients', async ({ page, deskUrl }) => {
  addFanoutProject(workspaceRoot());
  const requests: string[] = [];
  const pendingPeer: { release?: () => void } = {};
  await page.route(/\/api\/agent\/conversations\/latest\?scope=(mockproj|mockpeer)$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: null, messages: [] }),
  }));
  await page.route('**/api/agent/chat', async (route) => {
    const request = route.request().postDataJSON() as { project: string };
    requests.push(request.project);
    if (request.project === FANOUT_PROJECT) {
      await new Promise<void>((resolve) => { pendingPeer.release = resolve; });
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: `0:${JSON.stringify(`Response from ${request.project}`)}\nd:${JSON.stringify({ finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } })}\n`,
    });
  });

  await page.goto(deskUrl);
  await selectProjectCommandTarget(page);
  await page.getByText(/^Send to multiple projects/).click();
  await page.getByRole('checkbox', { name: `Send to ${PROJECT}` }).check();
  await page.getByRole('checkbox', { name: `Send to ${FANOUT_PROJECT}` }).check();
  await page.locator('#command-dock-input').fill('Keep every recipient running');
  await page.getByRole('button', { name: 'Send to selected projects' }).click();

  await expect.poll(() => requests.length).toBe(2);
  const projectResponse = page.getByRole('complementary', { name: `Response from agent-control in ${PROJECT}` });
  await expect(projectResponse).toContainText(`Response from ${PROJECT}`);
  await expect(projectResponse.getByRole('button', { name: 'Continue' })).toBeDisabled();

  pendingPeer.release?.();
  await expect(page.getByRole('list', { name: 'Project response statuses' }).getByText('Response ready')).toHaveCount(2);
  await expect(projectResponse.getByRole('button', { name: 'Continue' })).toBeEnabled();
});

test('keeps successful project responses when another fan-out recipient fails', async ({ page, deskUrl }) => {
  addFanoutProject(workspaceRoot());
  const requestProjects: string[] = [];
  await page.route(/\/api\/agent\/conversations\/latest\?scope=(mockproj|mockpeer)$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: null, messages: [] }),
  }));
  await page.route('**/api/agent/chat', async (route) => {
    const request = route.request().postDataJSON() as { project: string };
    requestProjects.push(request.project);
    if (request.project === FANOUT_PROJECT) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Mock peer is unavailable.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: `0:${JSON.stringify(`Response from ${request.project}`)}\nd:${JSON.stringify({ finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } })}\n`,
    });
  });

  await page.goto(deskUrl);
  await selectProjectCommandTarget(page);
  await page.getByText(/^Send to multiple projects/).click();
  await page.getByRole('checkbox', { name: `Send to ${PROJECT}` }).check();
  await page.getByRole('checkbox', { name: `Send to ${FANOUT_PROJECT}` }).check();
  await page.locator('#command-dock-input').fill('Inspect each project independently');
  await page.getByRole('button', { name: 'Send to selected projects' }).click();

  await expect.poll(() => requestProjects.length).toBe(2);
  await expect(page.getByText(`Response from ${PROJECT}`)).toBeVisible();
  await expect(page.getByText('Mock peer is unavailable.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 of 2 project responses ready' })).toBeVisible();
});

test('Stop all project responses cancels every active fan-out recipient', async ({ page, deskUrl }) => {
  addFanoutProject(workspaceRoot());
  const requests: string[] = [];
  const release: Array<() => void> = [];
  await page.route(/\/api\/agent\/conversations\/latest\?scope=(mockproj|mockpeer)$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: null, messages: [] }),
  }));
  await page.route('**/api/agent/chat', async (route) => {
    const request = route.request().postDataJSON() as { project: string };
    requests.push(request.project);
    await new Promise<void>((resolve) => release.push(resolve));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: `0:${JSON.stringify(`Response from ${request.project}`)}\nd:${JSON.stringify({ finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } })}\n`,
      });
    } catch {
      // Stopping the fan-out aborts each recipient's independent request.
    }
  });

  await page.goto(deskUrl);
  await selectProjectCommandTarget(page);
  await page.getByText(/^Send to multiple projects/).click();
  await page.getByRole('checkbox', { name: `Send to ${PROJECT}` }).check();
  await page.getByRole('checkbox', { name: `Send to ${FANOUT_PROJECT}` }).check();
  await page.locator('#command-dock-input').fill('Stop this fan-out');
  await page.getByRole('button', { name: 'Send to selected projects' }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Stop all project responses' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop all project responses' }).click();
  release.forEach((resolve) => resolve());

  await expect(page.getByRole('status').filter({ hasText: 'Project fan-out stopped' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Project response statuses' }).getByText('Stopped')).toHaveCount(2);
});

test('drafts a scoped task from the response without saving it', async ({ page, deskUrl }) => {
  await mockCommandTool(page, 'list_tasks', {}, { tasks: [] });
  let taskWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/agent/desk/pm/tasks')) taskWrites++;
  });

  await page.goto(deskUrl);
  await sendCommandAndInspectEvidence(page);
  await page.getByRole('button', { name: 'Draft task from response' }).click();

  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible();
  const backlog = page.getByRole('form', { name: 'New mission' });
  const title = backlog.getByRole('textbox', { name: 'Mission title' });
  await expect(title).toHaveValue('Evidence is ready');
  await expect(title).toBeFocused();
  await expect(backlog.getByRole('combobox', { name: 'For' })).toHaveValue(PROJECT);
  await expect(backlog.getByText('Suggested from the response. Review and edit before adding.')).toBeVisible();
  expect(taskWrites).toBe(0);
});

test('drafts a scoped Markdown note from the response without saving it', async ({ page, deskUrl }) => {
  await mockCommandTool(page, 'list_tasks', {}, { tasks: [] });
  let noteWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/agent/desk/notes')) noteWrites++;
  });

  await page.goto(deskUrl);
  await sendCommandAndInspectEvidence(page);
  await page.getByRole('button', { name: 'Draft note from response' }).click();

  const notes = page.getByRole('dialog', { name: 'Notes' });
  await expect(notes.getByRole('textbox', { name: 'Title' })).toHaveValue('Evidence is ready');
  await expect(notes.getByRole('textbox', { name: 'Note' })).toHaveValue('Evidence is ready.');
  await expect(notes.locator('#desk-project')).toBeDisabled();
  await expect(notes.getByRole('button', { name: 'Add note' })).toBeVisible();
  expect(noteWrites).toBe(0);

  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(notes.locator('.section-doc').getByText('Evidence is ready', { exact: true })).toBeVisible();
  await expect(notes.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  const file = join(workspaceRoot(), 'context', 'memory', 'projects', PROJECT, 'notes', 'evidence-is-ready.md');
  expect(readFileSync(file, 'utf-8')).toContain('Evidence is ready.');
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
  writeFileSync(join(worktreeOf(workspaceRoot()), 'NOTES.md'), '# Notes\nfrom the agent\n');
  await bar.getByRole('button', { name: 'Changes' }).click();
  const changes = drawer.getByLabel('Changes in the coding session');
  await expect(changes.getByText('NOTES.md')).toBeVisible();
  await expect(changes.getByText('from the agent')).toBeVisible();
});
