import { test, expect } from './fixtures.js';
import { APPROVALS, PROJECT } from './workspace.js';

/** The approval inbox (PR #10): what it shows, and that a decision sticks. */

test('shows only the live request, and approving it clears the inbox for good', async ({ page, appUrl }) => {
  await page.goto(appUrl);
  await page.locator('#project-select').selectOption(PROJECT);

  const inbox = page.getByRole('region', { name: 'Pending approvals' });
  await expect(inbox.getByText('Pending approval (1)')).toBeVisible();
  await expect(inbox.locator('.approval-action')).toHaveText(APPROVALS.live.action);
  // The expired request and the already-decided one are not pending (ADR-0020: decide once).
  await expect(inbox.getByText(APPROVALS.expired.action)).toHaveCount(0);
  await expect(inbox.getByText(APPROVALS.decided.action)).toHaveCount(0);

  await inbox.getByRole('button', { name: 'Approve' }).click();
  await expect(inbox).toHaveCount(0);

  // The decision was recorded, not just hidden in this tab: a reload still shows nothing.
  await page.reload();
  await expect(page.locator('#project-select')).toHaveValue(PROJECT);
  await expect(page.getByRole('region', { name: 'Pending approvals' })).toHaveCount(0);
});
