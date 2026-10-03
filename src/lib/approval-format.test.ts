import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatExpiry, isExpired } from './approval-format.js';

const BASE = new Date('2026-10-03T12:00:00.000Z').getTime();

describe('formatExpiry', () => {
  it('counts down in whole minutes while more than a minute remains', () => {
    assert.equal(formatExpiry(new Date(BASE + 10 * 60_000).toISOString(), BASE), 'expires in 10m');
    assert.equal(formatExpiry(new Date(BASE + 90_000).toISOString(), BASE), 'expires in 1m');
  });

  it('warns under a minute, and reports an expired request plainly', () => {
    assert.equal(formatExpiry(new Date(BASE + 30_000).toISOString(), BASE), 'expires in under a minute');
    assert.equal(formatExpiry(new Date(BASE - 1).toISOString(), BASE), 'expired');
    assert.equal(formatExpiry(new Date(BASE).toISOString(), BASE), 'expired');
  });
});

describe('isExpired', () => {
  it('matches the boundary formatExpiry uses', () => {
    assert.equal(isExpired(new Date(BASE + 1).toISOString(), BASE), false);
    assert.equal(isExpired(new Date(BASE).toISOString(), BASE), true);
  });
});
