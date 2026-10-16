import { test, expect } from './fixtures.js';

/**
 * The server injects its token into the HTML it serves, so an operator who reloads the page
 * without the `?token=` query - or opens the bare origin - still gets an authenticated app.
 * That only works if the inline script satisfies the response's own Content-Security-Policy,
 * which is what this pins down.
 */

test('authenticates a page opened without the token in its URL', async ({ page, origin }) => {
  await page.goto(origin);

  // Nothing in the URL to fall back on: the injected script is the only source.
  expect(new URL(page.url()).search).toBe('');
  expect(
    await page.evaluate(() => (globalThis as unknown as { __AC_TOKEN__?: string }).__AC_TOKEN__),
  ).toMatch(/^[a-f0-9]{64}$/);
  // The floor is an authenticated request; its room appears only if the token worked.
  await expect(page.getByRole('article', { name: 'Project mockproj' })).toBeVisible();
});
