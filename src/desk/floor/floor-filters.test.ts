import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLastActive, zoneLabel } from './FloorView';

describe('floor-filters and helpers', () => {
  it('formats zoneLabel correctly for standard and unregistered clients', () => {
    assert.equal(zoneLabel('acme'), 'acme');
    assert.equal(zoneLabel('-'), 'unregistered');
  });

  it('formats formatLastActive across recent, hours, days, and missing timestamps', () => {
    assert.equal(formatLastActive(null), 'no recorded activity');
    assert.equal(formatLastActive(undefined), 'no recorded activity');
    assert.equal(formatLastActive('invalid'), 'no recorded activity');

    const now = Date.now();
    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
    assert.equal(formatLastActive(tenMinAgo), 'just now');

    const threeHoursAgo = new Date(now - 3 * 3600 * 1000).toISOString();
    assert.equal(formatLastActive(threeHoursAgo), '3h ago');

    const twoDaysAgo = new Date(now - 49 * 3600 * 1000).toISOString();
    assert.match(formatLastActive(twoDaysAgo), /^2d ago \(\d{4}-\d{2}-\d{2}\)$/);
  });
});
