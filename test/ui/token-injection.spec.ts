import { test, expect } from './fixtures.js';

test('authenticates through the loopback exchange without putting a token in HTML or the URL', async ({ page, origin, token }) => {
  const authRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth') authRequests.push(request.method());
  });
  await page.goto(origin);

  expect(new URL(page.url()).search).toBe('');
  const html = await (await page.request.get(origin)).text();
  expect(html).not.toContain(token);
  expect(html).not.toContain('__AC_TOKEN__');
  expect(await page.evaluate(() => (globalThis as unknown as { __AC_TOKEN__?: string }).__AC_TOKEN__)).toBeUndefined();
  expect(await page.evaluate(() => sessionStorage.getItem('agent-control:token'))).toBeNull();
  expect(authRequests).toContain('GET');
  await expect(page.getByRole('article', { name: 'Project mockproj' })).toBeVisible();
});
