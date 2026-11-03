import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

const workspaceRoot = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const activityFile = (root: string, session: string) => join(root, '.local', 'agent', 'activity', `${session}.json`);

/** What `ws agent activity` writes for an outside agent session. */
function reportActivity(root: string, session: string, tool: string, state: string, detail: string): void {
  mkdirSync(join(root, '.local', 'agent', 'activity'), { recursive: true });
  writeFileSync(activityFile(root, session), JSON.stringify({
    version: 1, session, project: PROJECT, tool, state, detail, at: new Date().toISOString(),
  }));
}

test('keeps the project map as the home focus and tucks exploration tools away', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);

  const navbar = page.locator('.desk-bar');
  await expect(navbar.getByRole('heading', { name: 'Workspace map' })).toBeVisible();
  await expect(page.locator('.desk-main').getByRole('heading', { name: 'Workspace map' })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/agent-control-home-map-desktop.png' });
  await expect(page.getByRole('heading', { name: 'Your AI studio' })).toHaveCount(0);
  await expect(navbar.getByLabel('Workspace agent activity')).toContainText('Active');
  await expect(navbar.getByLabel('Workspace agent activity')).toContainText('Waiting');
  const room = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(room.locator('.studio-scene')).toBeVisible();
  await expect(room.locator('.seat-state').first()).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search projects' })).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Studio view scale' })).not.toBeVisible();

  const exploreDisclosure = navbar.locator('.floor-explore > summary');
  await exploreDisclosure.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('searchbox', { name: 'Search projects' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Studio view scale' })).toBeVisible();
  await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();
});

test('keeps the floor HUD out of the navbar on other desk pages', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Today' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.locator('.desk-bar').getByRole('heading', { name: 'Workspace map' })).toHaveCount(0);
  await expect(page.locator('.desk-bar').getByLabel('Workspace agent activity')).toHaveCount(0);
  await expect(page.locator('.desk-bar').getByText('Explore map', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Floor position' })).toContainText('Today');
});

test('studio offers compact mode and keeps project and agent access on mobile', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await expect(page.locator('.desk-bar').getByRole('heading', { name: 'Workspace map' })).toBeVisible();
  const room = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(room).toBeVisible();
  await page.getByText('Explore map', { exact: true }).click();
  const scale = page.getByRole('combobox', { name: 'Studio view scale' });
  await scale.selectOption('immersive');
  await expect(scale).toHaveValue('immersive');
  await page.screenshot({ path: '/tmp/agent-control-studio-desktop.png', fullPage: true });
  await scale.selectOption('overview');
  await expect(scale).toHaveValue('overview');
  await page.getByRole('button', { name: 'Switch to compact view' }).click();
  await expect(page.getByRole('button', { name: 'Switch to studio view' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Switch to studio view' }).click();
  await expect(page.getByRole('combobox', { name: 'Studio view scale' })).toHaveValue('overview');
  await page.getByRole('combobox', { name: 'Studio view scale' }).selectOption('immersive');
  await page.getByText('Explore map', { exact: true }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await room.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const documentWidth = await page.locator('html').evaluate((root) => root.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(width);
    const mainHasHorizontalOverflow = await page.locator('.desk-main').evaluate((main) => main.scrollWidth > main.clientWidth);
    expect(mainHasHorizontalOverflow).toBe(false);
    const title = await page.locator('.desk-floor-hud h1').boundingBox();
    const stats = await page.locator('.desk-floor-hud .studio-world-status').boundingBox();
    const explore = await page.locator('.desk-floor-hud .floor-explore > summary').boundingBox();
    expect(title).not.toBeNull();
    expect(stats).not.toBeNull();
    expect(explore).not.toBeNull();
    expect(title!.x + title!.width).toBeLessThanOrEqual(stats!.x);
    expect(explore!.x + explore!.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(room.getByRole('button', { name: PROJECT, exact: true })).toBeVisible();
  await expect(room.getByRole('button', { name: new RegExp(`^agent-control in ${PROJECT}`) })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.desk-main').evaluate((main) => { main.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/agent-control-studio-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('.desk-main').evaluate((main) => { main.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/agent-control-studio-dark.png', fullPage: true });
  await room.getByRole('button', { name: PROJECT, exact: true }).click();
  await expect(page.getByRole('heading', { name: PROJECT, exact: true })).toBeVisible();
});

test('seats agents at the desks of their room, posed by state, and queues those beyond the desks', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  const visitors = [
    { session: 'voxel-typing', tool: 'codex', state: 'typing', detail: 'Edit' },
    { session: 'voxel-thinking', tool: 'cursor', state: 'thinking', detail: 'Planning' },
    { session: 'voxel-reading', tool: 'opencode', state: 'reading', detail: 'Read' },
  ];
  try {
    for (const visitor of visitors) reportActivity(root, visitor.session, visitor.tool, visitor.state, visitor.detail);
    await page.goto(deskUrl);
    const room = page.getByRole('article', { name: `Project ${PROJECT}` });
    for (const visitor of visitors) {
      await expect(room.getByRole('button', { name: new RegExp(`^${visitor.tool} in ${PROJECT}: `) })).toBeVisible();
    }

    // Three desks: three characters with name plates, every further agent waits in the queue.
    const seats = room.locator('.seat');
    const total = await seats.count();
    expect(total).toBeGreaterThan(3);
    await expect(room.locator('.studio-scene .vx-agent')).toHaveCount(3);
    await expect(room.locator('.seat.is-seated')).toHaveCount(3);
    await expect(room.locator('.room-queue .seat')).toHaveCount(total - 3);

    // A pose never lies: each seated plate's state has its character in the scene.
    for (const seat of await room.locator('.seat.is-seated').all()) {
      const state = (await seat.getAttribute('class'))!.match(/\bseat-([a-z]+)\b/)![1];
      await expect(room.locator(`.studio-scene .vx-agent-${state}`)).toHaveCount(1);
    }
    await page.locator('.desk-main').evaluate((main) => { main.scrollTop = 0; });
    await room.screenshot({ path: '/tmp/agent-control-voxel-room.png' });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await room.screenshot({ path: '/tmp/agent-control-voxel-room-dark.png' });
    await page.getByRole('button', { name: 'Switch to light mode' }).click();

    // A plate is the agent's control: it opens that agent's drawer.
    await room.getByRole('button', { name: new RegExp(`^cursor in ${PROJECT}: thinking`) }).click();
    await expect(page.getByRole('dialog', { name: 'Assistant' })).toBeVisible();
  } finally {
    for (const visitor of visitors) rmSync(activityFile(root, visitor.session), { force: true });
  }
});
