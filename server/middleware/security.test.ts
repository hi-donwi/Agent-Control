import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { contentSecurityPolicy, desktopOriginOnly, tokenAuth } from './security.js';

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

describe('tokenAuth', () => {
  function protectedApp(allowQueryToken?: boolean) {
    const app = new Hono();
    app.use('*', tokenAuth('secret-token', { allowQueryToken }));
    app.get('/api/agent/health', (c) => c.json({ ok: true }));
    return app;
  }

  it('accepts a bearer token in desktop mode', async () => {
    const response = await protectedApp(false).request('/api/agent/health', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 200);
  });

  it('rejects a query token when desktop mode disables URL credentials', async () => {
    const response = await protectedApp(false).request('/api/agent/health?token=secret-token');
    assert.equal(response.status, 401);
  });

  it('rejects same-character-count Unicode tokens without throwing', async () => {
    const token = 'a'.repeat(62) + '😀';
    const response = await protectedApp().request(`/api/agent/health?token=${encodeURIComponent(token)}`);
    assert.equal(response.status, 401);
  });

  it('preserves query-token login for the existing browser host by default', async () => {
    const response = await protectedApp().request('/api/agent/health?token=secret-token');
    assert.equal(response.status, 200);
  });
});

describe('desktopOriginOnly', () => {
  function desktopApp() {
    const app = new Hono();
    app.use('*', desktopOriginOnly(['tauri://localhost']));
    app.get('/api/agent/health', (c) => c.json({ ok: true }));
    return app;
  }

  it('allows only the trusted Tauri origin and adds a non-credentialed CORS header', async () => {
    const response = await desktopApp().request('/api/agent/health', {
      headers: { Origin: 'tauri://localhost' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'tauri://localhost');
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  });

  it('rejects missing and unrelated origins', async () => {
    assert.equal((await desktopApp().request('/api/agent/health')).status, 403);
    assert.equal((await desktopApp().request('/api/agent/health', {
      headers: { Origin: 'https://attacker.invalid' },
    })).status, 403);
  });

  it('answers only allowed preflight methods and headers', async () => {
    const response = await desktopApp().request('/api/agent/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'tauri://localhost',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

    const denied = await desktopApp().request('/api/agent/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'tauri://localhost',
        'Access-Control-Request-Method': 'TRACE',
      },
    });
    assert.equal(denied.status, 403);
  });
});
