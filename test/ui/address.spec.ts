import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { addFloorProjects, PROJECT, removeFloorProjects } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * The address carries where the desk is, so reload, Back, and Forward land in the same place;
 * and each page load obtains a fresh in-memory token through the loopback auth endpoint.
 */

const workspaceRoot = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;

const query = (page: Page) => new URL(page.url()).searchParams;

test('the page ignores stale URL tokens and authenticates again after reload', async ({ page, deskUrl }) => {
  await page.goto(`${deskUrl}?token=${'f'.repeat(64)}`);
  const table = page.getByRole('article', { name: `Project ${PROJECT}` });
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => (globalThis as { __AC_TOKEN__?: string }).__AC_TOKEN__)).toBeUndefined();
  expect(await page.evaluate(() => sessionStorage.getItem('agent-control:token'))).toBeNull();
  await expect.poll(() => query(page).has('token')).toBe(false);

  // A reload performs a new loopback exchange instead of reading a browser token store.
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

test('a refused loopback exchange prevents the desk from rendering', async ({ page, deskUrl }) => {
  await page.route('**/auth', (route) => route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Loopback authentication is required.' }),
  }));
  await page.goto(deskUrl);
  await expect(page.getByText('Unable to authenticate with the local DONWI Desk host. Reload or restart it.')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
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
