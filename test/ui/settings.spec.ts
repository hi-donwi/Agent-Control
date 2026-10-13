import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { ANTHROPIC_KEY, MASKED_ANTHROPIC_KEY, MASKED_OPENAI_KEY, NEW_GOOGLE_KEY, OPENAI_KEY } from './workspace.js';

/** The settings dialog: what it shows a stored key, and what saving writes. */

const configPath = (home: string) => join(home, '.agent-control', 'config.json');
const readConfig = (home: string) => JSON.parse(readFileSync(configPath(home), 'utf-8')) as {
  providers: Record<string, { apiKey: string }>;
};

test('shows stored keys masked, and saving a new one leaves the others intact', async ({ page, appUrl, home }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: /Settings/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  // The API never hands the browser a full key, only a mask (first eight characters).
  await expect(dialog.locator('#openai-key')).toHaveValue(MASKED_OPENAI_KEY);
  await expect(dialog.locator('#anthropic-key')).toHaveValue(MASKED_ANTHROPIC_KEY);
  await expect(dialog.locator('#google-key')).toHaveValue('');
  await expect(dialog).toContainText('~/.agent-control/config.json');

  await dialog.locator('#google-key').fill(NEW_GOOGLE_KEY);
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toHaveCount(0);
  // The refresh after a save is what puts the new provider in the selector.
  await expect(page.locator('#provider-select option[value="google"]')).toHaveCount(1);

  const config = readConfig(home);
  expect(config.providers.google.apiKey).toBe(NEW_GOOGLE_KEY);
  // The untouched fields were masks, and a mask must never overwrite the real key.
  expect(config.providers.openai.apiKey).toBe(OPENAI_KEY);
  expect(config.providers.anthropic.apiKey).toBe(ANTHROPIC_KEY);
});

test('closes on Escape and writes nothing', async ({ page, appUrl, home }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: /Settings/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#anthropic-key').fill('sk-ant-should-not-be-saved');
  await page.keyboard.press('Escape');

  await expect(dialog).toHaveCount(0);
  expect(readConfig(home).providers.anthropic.apiKey).toBe(ANTHROPIC_KEY);
});
