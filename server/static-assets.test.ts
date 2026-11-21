import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import test from 'node:test';
import { registerStaticAssets } from './static-assets.js';

test('serves unauthenticated HTML without injecting a process token', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'desk-static-'));
  const html = '<!doctype html><html><head></head><body>Desk</body></html>';
  writeFileSync(join(dist, 'index.html'), html);
  try {
    const app = new Hono();
    registerStaticAssets(app, dist);
    const response = await app.request('/');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
