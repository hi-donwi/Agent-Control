import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDesktopTools } from './desktop-tools.js';

const valid = ['ws', 'brain', 'rg', 'git'].map((name) => ({
  name, available: true, path: `/usr/bin/${name}`, source: 'path', overridden: false,
}));

test('validates all required dependency statuses and source provenance', () => {
  assert.equal(validateDesktopTools({ tools: valid }).length, 4);
});

test('rejects missing tools masquerading as available or unknown metadata', () => {
  assert.throws(() => validateDesktopTools({ tools: [...valid.slice(1), {
    name: 'ws', available: true, path: null, source: 'missing', overridden: false,
  }] }));
  assert.throws(() => validateDesktopTools({ tools: [...valid.slice(1), {
    name: 'ws', available: true, path: '/usr/bin/ws', source: 'path', overridden: false, token: 'secret',
  }] }));
  assert.throws(() => validateDesktopTools({ tools: valid.slice(0, 3) }));
});
