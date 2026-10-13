import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentSecurityPolicy } from './security.js';

describe('contentSecurityPolicy', () => {
  it('allows only same-origin scripts when the response has no nonce', () => {
    const csp = contentSecurityPolicy();
    assert.match(csp, /script-src 'self';/);
    assert.doesNotMatch(csp, /nonce-/);
  });

  it('adds the one nonce the injected token script carries', () => {
    assert.match(contentSecurityPolicy('abc123'), /script-src 'self' 'nonce-abc123'/);
  });

  it('keeps the rest of the policy identical either way', () => {
    const withoutNonce = contentSecurityPolicy();
    const withNonce = contentSecurityPolicy('abc123');
    assert.equal(
      withNonce.replace("script-src 'self' 'nonce-abc123'", "script-src 'self'"),
      withoutNonce,
    );
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ]) {
      assert.ok(withNonce.includes(directive), directive);
    }
  });
});
