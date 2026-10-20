import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioLayout } from './studio-layout';

test('project scenery is stable and independent of project ordering or live status', () => {
  const keys = ['alpha', 'beta', 'gamma', '', 'a'.repeat(1000)];
  const first = keys.map(studioLayout);
  assert.deepEqual([...keys].reverse().map(studioLayout).reverse(), first);
  assert.ok(first.every((layout) => ['atelier', 'library', 'lab'].includes(layout)));
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => studioLayout(`project-${i}`))).size === 3);
});
