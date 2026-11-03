import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { addFloorProjects, PROJECT, removeFloorProjects } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

const workspaceRoot = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const activityFile = (root: string, session: string) => join(root, '.local', 'agent', 'activity', `${session}.json`);
const TABLES_PER_PAGE = 6;
const SEATS = 4;

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
  await expect(navbar.getByLabel('Workspace agent activity')).toContainText('Working');
  await expect(navbar.getByLabel('Workspace agent activity')).toContainText('Needs you');
  const room = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(page.locator('.level-stage .studio-scene')).toBeVisible();
  await expect(room.getByRole('button', { name: new RegExp(`^agent-control in ${PROJECT}`) })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search projects' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to compact view' })).not.toBeVisible();

  const exploreDisclosure = navbar.locator('.floor-explore > summary');
  await exploreDisclosure.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('searchbox', { name: 'Search projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to compact view' })).toBeVisible();
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

test('a level fits the screen without scrolling, in studio and compact view, and keeps project and agent access on mobile', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await expect(page.locator('.desk-bar').getByRole('heading', { name: 'Workspace map' })).toBeVisible();
  const room = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(room).toBeVisible();
  await page.getByText('Explore map', { exact: true }).click();
  await page.getByRole('button', { name: 'Switch to compact view' }).click();
  await expect(page.getByRole('button', { name: 'Switch to studio view' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.level-cards')).toBeVisible();
  await expect(room).toBeVisible();
  await page.getByRole('button', { name: 'Switch to studio view' }).click();
  await expect(page.locator('.level-stage')).toBeVisible();
  await page.getByText('Explore map', { exact: true }).click();
  for (const [width, height] of [[320, 640], [768, 900], [1024, 768], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    const bounds = await room.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    // One level per screen: neither the document nor the floor scrolls, either way.
    for (const scroller of ['html', '.desk-main']) {
      const overflow = await page.locator(scroller).evaluate((element) => ({
        x: element.scrollWidth - element.clientWidth,
        y: element.scrollHeight - element.clientHeight,
      }));
      expect(overflow, `${scroller} at ${width}x${height}`).toEqual({ x: 0, y: 0 });
    }
    // The stage stays clear of the command dock while it rests.
    const stage = await page.locator('.level-stage').boundingBox();
    const dock = await page.getByRole('region', { name: 'Agent command dock' }).boundingBox();
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(dock!.y + 1);
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
  await page.screenshot({ path: '/tmp/agent-control-studio-mobile.png' });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.screenshot({ path: '/tmp/agent-control-studio-dark.png' });
  await room.getByRole('button', { name: PROJECT, exact: true }).click();
  await expect(page.getByRole('heading', { name: PROJECT, exact: true })).toBeVisible();
});

test('seats up to four agents at their project table, posed by state, and the rest stand by it', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  const visitors = [
    { session: 'voxel-typing', tool: 'codex', state: 'typing', detail: 'Edit' },
    { session: 'voxel-thinking', tool: 'cursor', state: 'thinking', detail: 'Planning' },
    { session: 'voxel-reading', tool: 'opencode', state: 'reading', detail: 'Read' },
    { session: 'voxel-waiting', tool: 'gemini', state: 'waiting', detail: 'Approve shell command' },
  ];
  try {
    for (const visitor of visitors) reportActivity(root, visitor.session, visitor.tool, visitor.state, visitor.detail);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(deskUrl);
    const room = page.getByRole('article', { name: `Project ${PROJECT}` });
    for (const visitor of visitors) {
      await expect(room.locator('.seat').filter({ hasText: new RegExp(`^${visitor.tool}`) })).toHaveCount(1);
    }

    // Four chairs: four characters at the table; the agents past them fold into one +N chip.
    const seats = room.locator('.seat');
    const total = await seats.count();
    expect(total).toBeGreaterThan(SEATS);
    await expect(page.locator('.level-stage .vx-agent')).toHaveCount(SEATS);
    const seated = room.locator('.seat.is-seated');
    await expect(seated).toHaveCount(SEATS);
    for (const standing of await room.locator('.seat:not(.is-seated)').all()) await expect(standing).toBeHidden();
    const more = total - SEATS;
    await expect(room.getByRole('button', { name: `${more} more ${more === 1 ? 'agent' : 'agents'} in ${PROJECT}`, exact: true })).toHaveText(`+${more}`);

    // A pose never lies: as many characters hold each state as seated chips name it.
    // Only an agent that needs you spells out its state on the chip.
    const states = new Map<string, number>();
    for (const seat of await seated.all()) {
      const state = (await seat.getAttribute('class'))!.match(/\bseat-([a-z]+)\b/)![1]!;
      states.set(state, (states.get(state) ?? 0) + 1);
      const spelled = state === 'waiting' || state === 'warning';
      await (spelled ? expect(seat.locator('.seat-state')).toBeVisible() : expect(seat.locator('.seat-state')).toBeHidden());
    }
    for (const [state, count] of states) await expect(page.locator(`.level-stage .vx-agent-${state}`)).toHaveCount(count);

    await page.locator('.level-stage').screenshot({ path: '/tmp/agent-control-voxel-level.png' });
    // A small stage keeps each chip to its status dot, so plates stay clear of their neighbours.
    await page.setViewportSize({ width: 1024, height: 700 });
    for (const seat of await seated.all()) {
      await expect(seat).toBeVisible();
      await expect(seat.locator('.seat-name')).toBeHidden();
      await expect(seat.locator('.seat-state')).toBeHidden();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.locator('.level-stage').screenshot({ path: '/tmp/agent-control-voxel-level-dark.png' });
    await page.getByRole('button', { name: 'Switch to light mode' }).click();

    // A chip is the agent's control: it opens that agent's drawer.
    const visitorChip = seated.filter({ hasText: /^(codex|cursor|opencode|gemini)/ }).first();
    await visitorChip.click();
    await expect(page.getByRole('dialog', { name: 'Assistant' })).toBeVisible();
  } finally {
    for (const visitor of visitors) rmSync(activityFile(root, visitor.session), { force: true });
  }
});

test('a table glows by what it signals, tells more on hover, and the floor zooms into its room and back out', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  reportActivity(root, 'glow-waiting', 'gemini', 'waiting', 'Approve shell command');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(deskUrl);
    const room = page.getByRole('article', { name: `Project ${PROJECT}` });
    await expect(room.locator('.seat').filter({ hasText: /^gemini/ })).toHaveCount(1);
    // An agent at the table needs you: the floor under it glows orange.
    await expect(page.locator('.level-scene .vx-glow.is-attention')).toHaveCount(1);

    // Hover tells more - when it was last active, who is at the table - and lights the floor under it.
    const name = room.getByRole('button', { name: PROJECT, exact: true });
    await name.hover();
    const card = page.getByRole('tooltip');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Last active');
    await expect(card).toContainText(/\d+ needs? you/);
    await expect(name).toHaveAttribute('aria-describedby', await card.getAttribute('id') ?? '');
    await expect(page.locator('.level-scene .vx-glow.is-focus')).toHaveCount(1);
    await expect(page.locator('.level-keys')).toBeVisible();

    // Into the room the floor zooms toward its table; Back zooms out of it and rings the plate.
    await name.click();
    await expect(page.locator('.level-stage')).toHaveAttribute('data-enter', 'zoom-in');
    await expect(page.getByLabel(`Project room ${PROJECT}`)).toBeVisible();
    await page.goBack();
    await expect(page.locator('.level-stage')).toHaveAttribute('data-enter', 'zoom-out');
    await expect(room).toHaveClass(/\bis-highlighted\b/);
  } finally {
    rmSync(activityFile(root, 'glow-waiting'), { force: true });
  }
});

test('walks the levels with up and down, and the pages of project tables with left and right', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  const tables = Array.from({ length: 8 }, (_, index) => `floor-table-${index + 1}`);
  const neighbour = 'zenith-portal';
  addFloorProjects(root, [...tables.map((key) => [key, 'framework'] as const), [neighbour, 'zenith']]);
  try {
    await page.goto(deskUrl);
    const level = page.locator('section.level');
    const title = level.getByRole('heading', { level: 2 });
    const levels = page.getByRole('navigation', { name: 'Levels' });
    const goTo = levels.getByRole('combobox', { name: 'Go to level' });

    // Levels stand in a fixed order, clients alphabetically from the top; home is the busiest.
    await expect(title).toHaveText('framework');
    await expect(level).toHaveAttribute('data-level', '2');
    await expect(levels.getByRole('button', { name: 'Level up' })).toBeDisabled();
    await page.keyboard.press('ArrowDown');
    await expect(title).toHaveText('zenith');
    await expect(level).toHaveAttribute('data-level', '1');
    await expect(page.getByRole('article', { name: `Project ${neighbour}` })).toBeVisible();
    await expect(levels.getByRole('button', { name: 'Level down' })).toBeDisabled();
    await page.keyboard.press('ArrowUp');
    await expect(title).toHaveText('framework');
    await goTo.selectOption('zenith');
    await expect(title).toHaveText('zenith');
    await levels.getByRole('button', { name: 'Level up' }).click();
    await expect(title).toHaveText('framework');
    await expect(goTo).toHaveValue('framework');

    // The building beside the level: a stop per floor, the current one marked; a click rides there.
    const building = page.getByRole('navigation', { name: 'Building' });
    await expect(building.getByRole('button')).toHaveCount(await goTo.locator('option').count());
    await expect(building.getByRole('button', { name: /^Level 2, framework,/ })).toHaveAttribute('aria-current', 'location');
    await building.getByRole('button', { name: /^Level 1, zenith,/ }).click();
    await expect(title).toHaveText('zenith');
    await expect(building.getByRole('button', { name: /^Level 1, zenith,/ })).toHaveAttribute('aria-current', 'location');
    await building.getByRole('button', { name: /^Level 2, framework,/ }).click();
    await expect(title).toHaveText('framework');

    // Pages: active tables first, quiet ones after, six at most to a page, every project once.
    const pager = page.locator('.level-pages');
    const dots = pager.getByRole('button', { name: /^Page \d+ of \d+/ });
    const pages = await dots.count();
    expect(pages).toBeGreaterThanOrEqual(2);
    await expect(dots.first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();
    const seen: string[] = [];
    for (let index = 0; index < pages; index += 1) {
      if (index > 0) await page.keyboard.press('ArrowRight');
      await expect(dots.nth(index)).toHaveAttribute('aria-current', 'page');
      const keys = await page.locator('.level-tables .room').evaluateAll((rooms) => rooms.map((room) => room.getAttribute('data-project')!));
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(TABLES_PER_PAGE);
      seen.push(...keys);
    }
    expect(seen.sort()).toEqual([PROJECT, ...tables].sort());
    await expect(pager).toContainText('Inactive projects');
    // A page of inactive projects has its lights off; the first page does not.
    await expect(page.locator('.level-stage')).toHaveClass(/\bis-lights-off\b/);
    await expect(page.getByRole('button', { name: 'Next projects' })).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await expect(dots.last()).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: '/tmp/agent-control-level-last-page.png' });
    await page.getByRole('button', { name: 'Previous projects' }).click();
    await expect(dots.nth(pages - 2)).toHaveAttribute('aria-current', 'page');
    await dots.first().click();
    await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();
    await expect(page.locator('.level-stage')).not.toHaveClass(/\bis-lights-off\b/);

    // Search reaches any level and page; arrow keys typed into it stay in the field.
    await page.getByText('Explore map', { exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search projects' });
    await search.fill(neighbour);
    await search.press('ArrowDown');
    await expect(title).toHaveText('framework');
    const results = page.getByRole('list', { name: 'Matching projects' });
    await results.getByRole('button', { name: new RegExp(`^${neighbour}`) }).click();
    await expect(title).toHaveText('zenith');
    await expect(page.getByRole('article', { name: `Project ${neighbour}` })).toHaveClass(/\bis-highlighted\b/);
    await search.fill('floor-table-8');
    await results.getByRole('button', { name: /^floor-table-8/ }).click();
    await expect(title).toHaveText('framework');
    await expect(page.getByRole('article', { name: 'Project floor-table-8' })).toBeVisible();
    await expect(dots.first()).not.toHaveAttribute('aria-current', 'page');
  } finally {
    removeFloorProjects(root, [...tables, neighbour]);
  }
});
