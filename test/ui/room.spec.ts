import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * The project room: one project's memory, mission board, crew, blockers, and context,
 * opened from its room on the floor. Every change it makes goes through the stub `ws`, so
 * the spec asserts on the files that stub writes.
 */

const workspaceRoot = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;

const ACTIVE = `# ${PROJECT} - active

- **Updated:** 2026-10-16
- **Stage:** Desk review
- **Current focus:** The project room

## Next up

- Wire the room into the floor

## Blocked on

| Item | Waiting for | Since |
|---|---|---|
| Release notes | Operator sign-off | 2026-10-15 |
`;

const DECISIONS = `# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-14 | Stations replace columns | Work moves through an agent's day |
`;

test.beforeAll(() => {
  const memory = join(workspaceRoot(), 'context', 'memory', 'projects', PROJECT);
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, 'active.md'), ACTIVE);
  writeFileSync(join(memory, 'decisions.md'), DECISIONS);
});

test('opens a project room from the floor with its memory, blockers, and context', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('article', { name: `Project ${PROJECT}` }).getByRole('button', { name: PROJECT, exact: true }).click();

  const room = page.getByLabel(`Project room ${PROJECT}`);
  await expect(room.getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
  await expect(room.getByText('Desk review')).toBeVisible();
  await expect(room.getByText('The project room')).toBeVisible();

  const memory = room.getByRole('region', { name: 'Memory' });
  await expect(memory.getByText('Wire the room into the floor')).toBeVisible();
  await expect(memory.getByText('Stations replace columns')).toBeVisible();

  // What memory says the project is blocked on is a blocker like any other.
  const blockers = room.getByRole('region', { name: 'Blockers' });
  await expect(blockers.getByText('Release notes')).toBeVisible();
  await expect(blockers.getByText(/Operator sign-off/)).toBeVisible();

  // The pack an agent bound here loads, and what its policy lets it reach.
  const context = room.getByRole('region', { name: 'Context' });
  await expect(context.getByText(`context/memory/projects/${PROJECT}/active.md`)).toBeVisible();
  await expect(context.getByText(/Autonomy: read/)).toBeVisible();

  // Escape leaves the room for the floor.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();
});

test('opens a read-only visual context map from the selected project room', async ({ page, deskUrl }) => {
  const run = '2026-10-30-140000-context-atlas-test';
  const dir = join(workspaceRoot(), 'context', 'runs', PROJECT, run);
  const planPath = join(dir, 'plan.md');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), '# Visual context fixture\n');
  writeFileSync(join(dir, 'handoff.md'), '## State\n\n`in progress`\n');
  writeFileSync(planPath, '| # | Task | Status | Notes |\n|---|---|---|---|\n| 1 | Draw the synthetic system | `pending` | Read-only fixture |\n');
  const originalPlan = readFileSync(planPath, 'utf-8');

  await page.goto(deskUrl);
  await page.getByRole('article', { name: `Project ${PROJECT}` }).getByRole('button', { name: PROJECT, exact: true }).click();
  const room = page.getByLabel(`Project room ${PROJECT}`);
  await room.getByRole('button', { name: 'Visual context' }).click();

  const context = room.getByRole('region', { name: 'Visual project context' });
  await expect(context.getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
  const views = context.getByRole('navigation', { name: 'Project views' });
  await views.getByRole('button', { name: /^Run plan/ }).click();
  await expect(context.getByRole('heading', { name: 'Run plan' })).toBeVisible();
  await expect(context.getByText('Draw the synthetic system')).toBeVisible();

  await room.getByRole('button', { name: 'Room', exact: true }).click();
  await expect(room.getByRole('region', { name: 'Mission board' })).toBeVisible();
  expect(readFileSync(planPath, 'utf-8')).toBe(originalPlan);
});

test('keeps the visual project context reachable on mobile', async ({ page, deskUrl }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(deskUrl);
  await page
    .getByRole('article', { name: `Project ${PROJECT}` })
    .getByRole('button', { name: PROJECT, exact: true })
    .click();

  const room = page.getByLabel(`Project room ${PROJECT}`);
  await room.getByRole('button', { name: 'Visual context' }).click();
  const context = room.getByRole('region', { name: 'Visual project context' });
  await expect(context.getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
  const openNavigation = context.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(openNavigation).toBeInViewport();
  await openNavigation.click();
  const navigation = context.getByRole('complementary', { name: 'Project navigation' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(context.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await expect(context.getByRole('button', { name: 'Close navigation' })).toHaveCount(0);
  await expect(context.locator('.atlas-sidebar')).toHaveCSS(
    'transform',
    /^matrix\(1, 0, 0, 1, -/,
  );
  await expect
    .poll(async () => {
      const bounds = await context.locator('.atlas-sidebar').boundingBox();
      return (bounds?.x ?? 0) + (bounds?.width ?? 0);
    })
    .toBeLessThanOrEqual(0);
  const documentFits = await page
    .locator('html')
    .evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(documentFits).toBe(true);
  await page.screenshot({
    path: 'test-results/project-context-atlas-mobile.png',
  });
});

test('adds a mission, moves it to In hands, and blocks it with a reason, through ws task', async ({ page, deskUrl }) => {
  const file = join(workspaceRoot(), 'context', 'tasks', PROJECT, 'task_map_the_room.md');
  await page.goto(deskUrl);
  await page.getByRole('article', { name: `Project ${PROJECT}` }).getByRole('button', { name: PROJECT, exact: true }).click();
  const board = page.getByRole('region', { name: 'Mission board' });

  // Refused before anything runs.
  await board.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(board.getByRole('alert')).toHaveText('[ERROR] a task needs a title');

  await board.getByRole('textbox', { name: 'New mission' }).fill('Map the room');
  await board.getByRole('combobox', { name: 'Priority' }).selectOption('high');
  await board.getByRole('button', { name: 'Add', exact: true }).click();
  const card = board.getByRole('listitem', { name: /^Task: Map the room/ });
  await expect(board.getByRole('region', { name: /^Queue, / }).getByRole('listitem', { name: /^Task: Map the room/ })).toBeVisible();
  expect(readFileSync(file, 'utf-8')).toContain('priority: high');

  // The keyboard path: a card's own menu moves it, with the revision it was read at.
  await card.getByRole('combobox', { name: 'Move Map the room' }).selectOption('hands');
  await expect.poll(() => readFileSync(file, 'utf-8')).toContain('status: in_progress');
  await expect(board.getByRole('region', { name: /^In hands, / }).getByRole('listitem', { name: /^Task: Map the room/ })).toBeVisible();

  // A block needs a reason; the card raises its hand and the Blockers panel lists it.
  await card.getByRole('button', { name: 'Block', exact: true }).click();
  await card.getByRole('textbox', { name: 'What blocks Map the room' }).fill('Waiting for the API key');
  await card.locator('form').getByRole('button', { name: 'Block' }).click();
  await expect.poll(() => readFileSync(file, 'utf-8')).toContain('blocked_reason: "Waiting for the API key"');
  await expect(board.getByRole('listitem', { name: 'Task: Map the room, blocked: Waiting for the API key' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Blockers' }).getByText('Waiting for the API key')).toBeVisible();

  await card.getByRole('button', { name: 'Unblock' }).click();
  await expect.poll(() => readFileSync(file, 'utf-8')).not.toContain('blocked');
  await expect(board.getByRole('listitem', { name: 'Task: Map the room', exact: true })).toBeVisible();
});

test('moves a run step along the board, through ws plan', async ({ page, deskUrl }) => {
  const run = '2026-10-16-100000-tester-room-step';
  const dir = join(workspaceRoot(), 'context', 'runs', PROJECT, run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), '# Room step\n\n- **Owner:** tester (desk)\n');
  writeFileSync(join(dir, 'handoff.md'), '## State\n\n`in progress`\n');
  writeFileSync(join(dir, 'plan.md'), '| # | Task | Status | Notes |\n|---|---|---|---|\n| 1 | Draw the stations | `pending` | |\n');

  await page.goto(deskUrl);
  await page.getByRole('article', { name: `Project ${PROJECT}` }).getByRole('button', { name: PROJECT, exact: true }).click();
  const board = page.getByRole('region', { name: 'Mission board' });
  const step = board.getByRole('listitem', { name: 'Run step: Draw the stations' });
  await expect(step).toBeVisible();

  // A plan row has no ready or review status, so its menu offers only the stations it can reach.
  const menu = step.getByRole('combobox', { name: 'Move Draw the stations' });
  await expect(menu.getByRole('option')).toHaveText(['Move to...', 'In hands', 'Shipped']);

  await menu.selectOption('shipped');
  await expect.poll(() => readFileSync(join(dir, 'plan.md'), 'utf-8')).toContain('| 1 | Draw the stations | `done` |');
  await expect(board.getByRole('region', { name: /^Shipped, / }).getByRole('listitem', { name: 'Run step: Draw the stations' })).toBeVisible();
});

test('blocks a run step with a reason, frees it, and drops another, through ws plan', async ({ page, deskUrl }) => {
  const run = '2026-10-17-090000-tester-room-holds';
  const dir = join(workspaceRoot(), 'context', 'runs', PROJECT, run);
  const plan = () => readFileSync(join(dir, 'plan.md'), 'utf-8');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), '# Room holds\n\n- **Owner:** tester (desk)\n');
  writeFileSync(join(dir, 'handoff.md'), '## State\n\n`in progress`\n');
  writeFileSync(join(dir, 'plan.md'), '| # | Task | Status | Notes |\n|---|---|---|---|\n| 1 | Define the schema | `pending` | |\n| 2 | Old approach | `pending` | |\n');

  await page.goto(deskUrl);
  await page.getByRole('article', { name: `Project ${PROJECT}` }).getByRole('button', { name: PROJECT, exact: true }).click();
  const board = page.getByRole('region', { name: 'Mission board' });
  const schema = board.getByRole('listitem', { name: /^Run step: Define the schema/ });

  // The reason becomes the row's Notes, and the room lists the step as a blocker.
  await schema.getByRole('button', { name: 'Block', exact: true }).click();
  await schema.getByRole('textbox', { name: 'What blocks Define the schema' }).fill('Waits on the API contract');
  await schema.locator('form').getByRole('button', { name: 'Block' }).click();
  await expect.poll(plan).toContain('| 1 | Define the schema | `blocked` | Waits on the API contract |');
  await expect(board.getByRole('listitem', { name: 'Run step: Define the schema, blocked: Waits on the API contract' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Blockers' }).getByText('Define the schema')).toBeVisible();

  await schema.getByRole('button', { name: 'Unblock' }).click();
  await expect.poll(plan).toContain('| 1 | Define the schema | `pending` |');
  await expect(board.getByRole('listitem', { name: 'Run step: Define the schema', exact: true })).toBeVisible();

  // Dropping needs a reason too; a dropped step leaves the board.
  const old = board.getByRole('listitem', { name: 'Run step: Old approach' });
  await old.getByRole('button', { name: 'Drop', exact: true }).click();
  await old.locator('form').getByRole('button', { name: 'Drop' }).click();
  await expect(board.getByRole('alert')).toHaveText('[ERROR] say why the step is dropped');
  await old.getByRole('textbox', { name: 'Why drop Old approach' }).fill('Superseded by the schema');
  await old.locator('form').getByRole('button', { name: 'Drop' }).click();
  await expect.poll(plan).toContain('| 2 | Old approach | `dropped` | Superseded by the schema |');
  await expect(old).toHaveCount(0);
});
