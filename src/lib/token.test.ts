import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthToken, withoutToken } from './token';

test('extracts the process token from the loopback auth response', () => {
  assert.equal(parseAuthToken({ token: 'a'.repeat(64) }), 'a'.repeat(64));
});

test('rejects malformed loopback auth responses', () => {
  for (const response of [null, {}, { token: 'short' }, { token: 'g'.repeat(64) }, { token: 'a'.repeat(64), extra: true }]) {
    assert.throws(() => parseAuthToken(response), /invalid authentication response/);
  }
});

test('taking the token out of the address keeps every other parameter', () => {
  assert.equal(withoutToken('?token=abc'), '');
  assert.equal(withoutToken('?token=abc&ui=classic'), '?ui=classic');
  assert.equal(withoutToken('?project=x&token=abc&view=modules'), '?project=x&view=modules');
  assert.equal(withoutToken('?ui=classic'), '?ui=classic');
  assert.equal(withoutToken(''), '');
});
