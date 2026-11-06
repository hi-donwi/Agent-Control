import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDesktopBootstrap, validateDesktopWorkspaceRoot } from './desktop-bootstrap.js';

describe('validateDesktopBootstrap', () => {
  const valid = {
    protocolVersion: 1,
    apiBaseUrl: 'http://127.0.0.1:43210',
    token: 'a'.repeat(64),
  };

  it('accepts a versioned loopback endpoint and process token', () => {
    assert.deepEqual(validateDesktopBootstrap(valid), {
      ...valid,
      apiBaseUrl: 'http://127.0.0.1:43210',
    });
  });

  it('rejects protocol, host, port, credential, and token violations', () => {
    for (const patch of [
      { protocolVersion: 2 },
      { apiBaseUrl: 'http://localhost:43210' },
      { apiBaseUrl: 'http://0.0.0.0:43210' },
      { apiBaseUrl: 'https://127.0.0.1:43210' },
      { apiBaseUrl: 'http://127.0.0.1:0' },
      { apiBaseUrl: 'http://user@127.0.0.1:43210' },
      { apiBaseUrl: 'http://127.0.0.1:43210/?token=secret' },
      { token: 'short' },
      { extra: 'unexpected' },
    ]) {
      assert.throws(() => validateDesktopBootstrap({ ...valid, ...patch }));
    }
    assert.throws(() => validateDesktopBootstrap(null));
  });
});

describe('validateDesktopWorkspaceRoot', () => {
  it('accepts an absent selection and a non-empty native filesystem path', () => {
    assert.equal(validateDesktopWorkspaceRoot(null), null);
    assert.equal(validateDesktopWorkspaceRoot('/Users/test/Agent-Workspace'), '/Users/test/Agent-Workspace');
  });

  it('rejects malformed or empty workspace status values', () => {
    for (const value of [undefined, '', '  ', 1, {}, '/path\u0000with-null']) {
      assert.throws(() => validateDesktopWorkspaceRoot(value));
    }
  });
});
