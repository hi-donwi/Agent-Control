import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToken, withoutToken } from './token';

test('the injected token wins, then the address, then the copy the tab kept', () => {
  assert.equal(resolveToken({ injected: 'served', search: '?token=linked', stored: 'kept' }), 'served');
  assert.equal(resolveToken({ injected: '', search: '?ui=classic&token=linked', stored: 'kept' }), 'linked');
  assert.equal(resolveToken({ search: '?project=x&view=modules', stored: 'kept' }), 'kept');
  assert.equal(resolveToken({ search: '', stored: null }), '');
});

test('taking the token out of the address keeps every other parameter', () => {
  assert.equal(withoutToken('?token=abc'), '');
  assert.equal(withoutToken('?token=abc&ui=classic'), '?ui=classic');
  assert.equal(withoutToken('?project=x&token=abc&view=modules'), '?project=x&view=modules');
  assert.equal(withoutToken('?ui=classic'), '?ui=classic');
  assert.equal(withoutToken(''), '');
});
