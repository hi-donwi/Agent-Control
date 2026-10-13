import { test, expect } from './fixtures.js';
import { PROJECT, SESSION_BRANCH, WORKTREE_TAIL } from './workspace.js';

/** The coding-session control (PR #12): start, stop, and what a session looks like. */

test('shows a project only when one is selected, and starts and stops its session', async ({ page, appUrl }) => {
  await page.goto(appUrl);
  const panel = page.locator('.coding-session-panel');
  await expect(panel).toHaveCount(0);

  await page.locator('#project-select').selectOption(PROJECT);

  // The seeded session: a worktree path shortened to its last two segments, and its branch.
  await expect(panel).toContainText('Coding session active');
  await expect(panel).toContainText(WORKTREE_TAIL);
  await expect(panel).toContainText(SESSION_BRANCH);

  // Stop goes through the real API and the stub `ws`; the panel falls back to Start.
  await panel.getByRole('button', { name: 'Stop coding session' }).click();
  const start = panel.getByRole('button', { name: 'Start coding session' });
  await expect(start).toBeVisible();

  // Start asks the stub `ws agent start`, parses its `cd <path>` line, and reads the real
  // worktree's branch - the same one the fixture seeded.
  await start.click();
  await expect(panel).toContainText('Coding session active');
  await expect(panel).toContainText(WORKTREE_TAIL);
  await expect(panel).toContainText(SESSION_BRANCH);
});
