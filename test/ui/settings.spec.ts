import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { LEGACY_ANTHROPIC_KEY, LEGACY_OPENAI_KEY } from './workspace.js';

/**
 * Chat runs only through Agent Brain, which keeps provider accounts and keys: no screen asks
 * for a key, and keys left in ~/.agent-control/config.json from before never reach the page.
 */

const configPath = (home: string) => join(home, '.agent-control', 'config.json');

test('the desk settings point at Agent Brain and hold no key field', async ({ page, deskUrl }) => {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('button', { name: 'Settings' }).click();

  await expect(page.getByText('Chat runs only through Agent Brain', { exact: false })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const suite = page.getByRole('region', { name: 'Agent Workspace Suite' });
  await expect(suite).toBeVisible();
  for (const component of ['Agent-Control', 'Agent-Brain', 'Agent-Workspace', 'Agent-Skills', 'Agent-Secure']) {
    await expect(suite.getByText(component, { exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(suite).toBeVisible();
  const noHorizontalOverflow = await page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: { documentElement: { scrollWidth: number } };
      window: { innerWidth: number };
    };
    return browser.document.documentElement.scrollWidth <= browser.window.innerWidth;
  });
  expect(noHorizontalOverflow).toBe(true);
});

test('the classic layout has no Settings button and lists no legacy provider', async ({ page, appUrl }) => {
  await page.goto(appUrl);
  await expect(page.locator('#provider-select option[value="mock"]')).toHaveCount(1);

  await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0);
  for (const id of ['openai', 'anthropic', 'google']) {
    await expect(page.locator(`#provider-select option[value="${id}"]`)).toHaveCount(0);
  }
  const html = await page.content();
  expect(html).not.toContain(LEGACY_OPENAI_KEY);
  expect(html).not.toContain(LEGACY_ANTHROPIC_KEY);
});

test('the key API is gone, and the legacy config is left as it was', async ({ page, deskUrl, origin, home }) => {
  const before = readFileSync(configPath(home), 'utf-8');
  const token = new URL(deskUrl).searchParams.get('token') ?? '';

  const saved = await page.request.post(`${origin}/api/agent/config?token=${token}`, {
    data: { providers: { google: { apiKey: 'AIza-should-not-be-saved' } } },
  });
  expect(saved.status()).toBe(404);
  // A GET of a path with no route falls through to the page itself; it carries no config.
  const read = await page.request.get(`${origin}/api/agent/config?token=${token}`);
  expect(read.headers()['content-type'] ?? '').not.toContain('application/json');
  const body = await read.text();
  expect(body).not.toContain(LEGACY_OPENAI_KEY.slice(0, 8));
  expect(body).not.toContain(LEGACY_ANTHROPIC_KEY.slice(0, 8));
  expect(readFileSync(configPath(home), 'utf-8')).toBe(before);
});
