import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { addFloorProjects, PROJECT, removeFloorProjects } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * The address carries where the desk is, so reload, Back, and Forward land in the same place;
 * and a tab keeps a token the server accepted, so a page that rewrites the address - the
 * project's visual context does - no longer signs it out.
 */

const workspaceRoot = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const TOKEN_KEY = 'agent-control:token';

/** Serves the page without the token the server injects - as the Vite dev server does - so only the address or the tab's own copy can sign it in. */
async function withoutInjectedToken(page: Page): Promise<void> {
  await page.route((url) => url.pathname === '/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/<script nonce="[^"]*">window\.__AC_TOKEN__="[^"]*";<\/script>/, '');
    await route.fulfill({ response, body });
  });
}

const query = (page: Page) => new URL(page.url()).searchParams;

test('a tab keeps the token the server accepted, and takes it out of the address', async ({ page, deskUrl }) => {
  await withoutInjectedToken(page);
  await page.goto(deskUrl);
  const table = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => (globalThis as { __AC_TOKEN__?: string }).__AC_TOKEN__)).toBeUndefined();
  await expect.poll(() => query(page).has('token')).toBe(false);

  // A reload has nothing in the address to sign in with: the tab's copy does it.
  await page.reload();
  await expect(table).toBeVisible();

  // The visual context writes its selection over the query; the desk stays signed in through it.
  await table.getByRole('button', { name: PROJECT, exact: true }).click();
  const room = page.getByLabel(`Project room ${PROJECT}`);
  await room.getByRole('button', { name: 'Visual context' }).click();
  await expect(room.getByRole('region', { name: 'Visual project context' })).toBeVisible();
  await expect.poll(() => query(page).get('project')).toBe(PROJECT);
  await page.reload();
  await expect(page.getByLabel(`Project room ${PROJECT}`)).toBeVisible();

  // Back on the floor, the visual context's selection leaves the address with it.
  await page.goBack();
  await expect(table).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('');
});

test('a refused token is forgotten, and the desk says how to sign in again', async ({ page, deskUrl }) => {
  await withoutInjectedToken(page);
  await page.goto(deskUrl);
  await expect(page.getByRole('article', { name: `Project ${PROJECT}` })).toBeVisible();

  // The server restarted with a new token; the one this tab kept no longer works.
  await page.evaluate((key) => sessionStorage.setItem(key, 'f'.repeat(64)), TOKEN_KEY);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'did not accept this page\'s token' })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();
});

test('the address keeps the desk position through reload, back, and forward', async ({ page, deskUrl }) => {
  const root = workspaceRoot();
  addFloorProjects(root, [['address-north', 'north']]);
  try {
    await page.goto(deskUrl);
    const title = page.locator('section.level').getByRole('heading', { level: 2 });
    const goTo = page.getByRole('navigation', { name: 'Levels' }).getByRole('combobox', { name: 'Go to level' });
    const hash = () => new URL(page.url()).hash;

    // A level is in the address, and a reload opens it again.
    await expect(goTo.getByRole('option', { name: /· north \(/ })).toHaveCount(1);
    await goTo.selectOption('north');
    await expect(title).toHaveText('north');
    expect(hash()).toBe('#/level/north');
    await page.reload();
    await expect(title).toHaveText('north');

    // Walking the floor is one history entry: Back from the room returns to the level last shown.
    await goTo.selectOption('framework');
    await expect(title).toHaveText('framework');
    await page.getByRole('article', { name: `Project ${PROJECT}` }).getByRole('button', { name: PROJECT, exact: true }).click();
    const room = page.getByLabel(`Project room ${PROJECT}`);
    await expect(room).toBeVisible();
    expect(hash()).toBe(`#/project/${PROJECT}`);
    await page.reload();
    await expect(room).toBeVisible();

    await page.goBack();
    await expect(title).toHaveText('framework');
    expect(hash()).toBe('#/level/framework');
    await page.goForward();
    await expect(room).toBeVisible();

    // An address typed by hand opens its view too.
    await page.evaluate('window.location.hash = "#/today"');
    await expect(page.getByRole('navigation', { name: 'Floor position' }).getByText('Today')).toBeVisible();
    await page.goBack();
    await expect(room).toBeVisible();
    expect(query(page).has('token')).toBe(false);
  } finally {
    removeFloorProjects(root, ['address-north']);
  }
});
