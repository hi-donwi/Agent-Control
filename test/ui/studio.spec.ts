import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';

test('keeps the project map as the home focus and tucks exploration tools away', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);

  await expect(page.getByRole('heading', { name: 'Workspace map' })).toBeVisible();
  await page.screenshot({ path: '/tmp/agent-control-home-map-desktop.png' });
  await expect(page.getByRole('heading', { name: 'Your AI studio' })).toHaveCount(0);
  await expect(page.getByLabel('Workspace agent activity')).toContainText('Active');
  await expect(page.getByLabel('Workspace agent activity')).toContainText('Waiting');
  const room = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(room.locator('.studio-scene')).toBeVisible();
  await expect(room.locator('.seat-state').first()).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search projects' })).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Studio view scale' })).not.toBeVisible();

  const exploreDisclosure = page.locator('.floor-explore > summary');
  await exploreDisclosure.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('searchbox', { name: 'Search projects' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Studio view scale' })).toBeVisible();
  await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();
});

test('studio offers compact mode and keeps project and agent access on mobile', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await expect(page.getByRole('heading', { name: 'Workspace map' })).toBeVisible();
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
