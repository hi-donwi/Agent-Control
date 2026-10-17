import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { PROJECT, SESSION_BRANCH, originOf, verifyStatusFile, worktreeOf } from './workspace.js';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * Handing a coding session's work back (desk phase 4b), against real git: the fixture's
 * session is a worktree of a product checkout with a bare origin. Verify is the stub `ws`;
 * ship and discard are the host's own git.
 */

const root = () => (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState).root;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

async function openChanges(page: import('@playwright/test').Page, deskUrl: string) {
  await page.goto(deskUrl);
  await page.getByRole('button', { name: 'Assistant' }).click();
  const drawer = page.getByRole('dialog', { name: 'Assistant' });
  await drawer.getByRole('combobox', { name: 'Assistant scope' }).selectOption(PROJECT);
  const bar = drawer.getByRole('region', { name: 'Coding session' });
  await expect(bar).toBeVisible();
  const start = bar.getByRole('button', { name: 'Start coding session' });
  if (await start.isVisible()) await start.click();
  await bar.getByRole('button', { name: 'Changes' }).click();
  return { drawer, bar, panel: drawer.getByRole('region', { name: 'Hand back' }) };
}

test('ships only verified work: verify, refuse after a change, verify again, push to main', async ({ page, deskUrl }) => {
  const wt = worktreeOf(root());
  writeFileSync(verifyStatusFile(root()), 'pass');
  writeFileSync(join(wt, 'feature.txt'), 'from the agent\n');
  const { bar, panel } = await openChanges(page, deskUrl);
  const ship = panel.getByRole('button', { name: 'Ship to main' });

  await panel.getByRole('button', { name: /^Verify/ }).click();
  await expect(panel.getByRole('status').filter({ hasText: '[PASS] Verify passed' })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Verification commands' })).toContainText('unit-tests');
  await expect(ship).toBeEnabled();

  // The agent writes again after verify: the host refuses to push what was not verified.
  writeFileSync(join(wt, 'feature.txt'), 'changed after verify\n');
  await panel.getByRole('textbox', { name: 'Commit message' }).fill('feat: the agent feature');
  await ship.click();
  await panel.getByRole('alertdialog', { name: 'Confirm ship' }).getByRole('button', { name: 'Push to main' }).click();
  await expect(bar.getByRole('alert')).toContainText('the worktree changed since it was verified');
  const before = git(originOf(root()), 'rev-parse', 'main');

  await panel.getByRole('button', { name: 'Verify again' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '[PASS] Verify passed' })).toBeVisible();
  await ship.click();
  await panel.getByRole('alertdialog', { name: 'Confirm ship' }).getByRole('button', { name: 'Push to main' }).click();
  await expect(panel.getByRole('status').filter({ hasText: /^\[PASS\] Shipped/ })).toContainText('to main (1 commit)');

  const origin = originOf(root());
  expect(git(origin, 'rev-parse', 'main')).not.toBe(before);
  expect(git(origin, 'log', '-1', '--format=%s', 'main')).toBe('feat: the agent feature');
  expect(git(origin, 'show', 'main:feature.txt')).toBe('changed after verify');
});

test('keeps ship closed while verify reports findings', async ({ page, deskUrl }) => {
  writeFileSync(verifyStatusFile(root()), 'findings');
  writeFileSync(join(worktreeOf(root()), 'second.txt'), 'not ready\n');
  const { panel } = await openChanges(page, deskUrl);

  await panel.getByRole('button', { name: /^Verify/ }).click();
  await expect(panel.getByRole('status').filter({ hasText: '[FAIL] Verify found problems' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ship to main' })).toBeDisabled();
  writeFileSync(verifyStatusFile(root()), 'pass');
});

test('discards a session after a second confirmation: worktree and branch go', async ({ page, deskUrl }) => {
  const wt = worktreeOf(root());
  const { bar, panel } = await openChanges(page, deskUrl);

  await panel.getByRole('button', { name: 'Discard session' }).click();
  const confirm = panel.getByRole('alertdialog', { name: 'Confirm discard' });
  await expect(confirm).toContainText(SESSION_BRANCH);
  // Cancel leaves everything as it was.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(existsSync(wt)).toBe(true);

  await panel.getByRole('button', { name: 'Discard session' }).click();
  await panel.getByRole('alertdialog', { name: 'Confirm discard' }).getByRole('button', { name: 'Discard everything' }).click();
  await expect(bar.getByRole('button', { name: 'Start coding session' })).toBeVisible();
  expect(existsSync(wt)).toBe(false);
  expect(git(join(root(), 'projects', 'mock', PROJECT), 'branch', '--list', '--format=%(refname:short)', SESSION_BRANCH)).toBe('');
});
