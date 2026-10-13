import { test, expect } from './fixtures.js';
import { PROJECT } from './workspace.js';

/** The chat itself, through the real server and the offline `mock` endpoint. */

test('answers a chat from the mock endpoint and streams it into the transcript', async ({ page, appUrl }) => {
  await page.goto(appUrl);

  await expect(page.locator('#project-select option[value="mockproj"]')).toHaveCount(1);
  await expect(page.locator('#provider-select option[value="mock"]')).toHaveCount(1);
  await page.locator('#provider-select').selectOption('mock');
  await expect(page.locator('#model-select')).toHaveValue('echo');

  await page.locator('#chat-input').fill('hello');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText('mock(echo): hello')).toBeVisible();
  await expect(page.locator('.message-role').first()).toHaveText('You');
});

test('disables a remote endpoint for a chat that is not bound to an allowing project', async ({ page, appUrl }) => {
  await page.goto(appUrl);

  // `mock` is local and always allowed; `remote` needs a project whose policy lists it
  // (ADR-0021), and this fixture's policy allows nothing.
  await expect(page.locator('#provider-select option[value="mock"]')).toBeEnabled();
  await expect(page.locator('#provider-select option[value="remote"]')).toBeDisabled();

  await page.locator('#project-select').selectOption(PROJECT);

  await expect(page.locator('#provider-select option[value="remote"]')).toBeDisabled();
  await expect(page.locator('#provider-select option[value="mock"]')).toBeEnabled();
});
