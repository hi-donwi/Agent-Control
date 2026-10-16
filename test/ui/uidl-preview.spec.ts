import { test, expect } from './fixtures.js';

/**
 * The in-chat UIDL preview. The `mock` endpoint echoes the last user message, so sending a
 * fenced document makes the assistant answer carry the same fence - no fixture endpoint and
 * no network needed to get a UIDL block into a reply.
 */

const DOC = '{"version":"1.0.0","root":{"id":"metrics","type":"Container","children":[{"id":"v1","type":"Text","props":{"value":"Operational"}}]}}';

/** The assistant bubble, so the user's own copy of the fence does not count. */
const assistant = (page: import('@playwright/test').Page) => page.locator('.message:has(.message-avatar.assistant)');

async function send(page: import('@playwright/test').Page, appUrl: string, message: string) {
  await page.goto(appUrl);
  await page.locator('#provider-select').selectOption('mock');
  await page.locator('#chat-input').fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test('renders a UIDL document as an interactive preview, with its raw JSON on the JSON tab', async ({ page, appUrl }) => {
  await send(page, appUrl, `here is the ui:\n\`\`\`uidl\n${DOC}\n\`\`\``);

  const card = assistant(page).locator('.uidl-preview-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.uidl-badge')).toHaveText('UIDL');
  await expect(card.locator('.uidl-doc-id')).toHaveText('metrics');
  // The default registry renders a Container/Text document: the value comes from props.
  await expect(card.locator('.uidl-rendered-container')).toContainText('Operational');

  await card.getByRole('tab', { name: 'JSON' }).click();
  await expect(card.locator('.uidl-json-view')).toContainText('"id":"metrics"');
});

test('leaves JSON that is not a UIDL document as a plain code block', async ({ page, appUrl }) => {
  await send(page, appUrl, 'here is data:\n```json\n{"hello":"world"}\n```');

  const answer = assistant(page);
  // Wait for the reply first, so "no preview" is a statement about a rendered answer.
  await expect(answer.locator('pre code')).toContainText('"hello":"world"');
  await expect(answer.locator('.code-header')).toHaveCount(1);
  await expect(answer.locator('.uidl-preview-card')).toHaveCount(0);
});
