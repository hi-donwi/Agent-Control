import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  apiOriginOnly, contentSecurityPolicy, desktopOriginOnly, isLoopbackBindHost, isLoopbackRemoteAddress, tokenAuth,
} from './security.js';

describe('standalone bind host', () => {
  it('accepts only the required loopback listener address', () => {
    assert.equal(isLoopbackBindHost('127.0.0.1'), true);
    assert.equal(isLoopbackBindHost('0.0.0.0'), false);
    assert.equal(isLoopbackBindHost('192.0.2.10'), false);
  });
});

describe('loopback peer address', () => {
  it('accepts loopback peers and rejects non-loopback peers', () => {
    assert.equal(isLoopbackRemoteAddress('127.0.0.1'), true);
    assert.equal(isLoopbackRemoteAddress('::1'), true);
    assert.equal(isLoopbackRemoteAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackRemoteAddress('192.0.2.10'), false);
    assert.equal(isLoopbackRemoteAddress(''), false);
  });
});

describe('contentSecurityPolicy', () => {
  it('allows only same-origin scripts with no inline script nonce', () => {
    const csp = contentSecurityPolicy();
    assert.match(csp, /script-src 'self';/);
    assert.doesNotMatch(csp, /nonce-/);
  });

  it('allows only explicitly configured Brain origins for the embedded management UI', () => {
    const csp = contentSecurityPolicy(['https://brain.example', 'http://127.0.0.1:52140', 'https://evil.invalid/path', 'javascript:alert(1)']);
    assert.match(csp, /frame-src 'self' https:\/\/brain\.example http:\/\/127\.0\.0\.1:52140/);
    assert.doesNotMatch(csp, /evil\.invalid|javascript:/);
  });

  it('keeps the rest of the policy restrictive', () => {
    const csp = contentSecurityPolicy();
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ]) {
      assert.ok(csp.includes(directive), directive);
    }
  });
});

describe('tokenAuth', () => {
  function protectedApp() {
    const app = new Hono();
    app.use('*', tokenAuth('secret-token'));
    app.get('/api/agent/health', (c) => c.json({ ok: true }));
    return app;
  }

  it('accepts a bearer token in desktop mode', async () => {
    const response = await protectedApp().request('/api/agent/health', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 200);
  });

  it('rejects a query token in every mode', async () => {
    const response = await protectedApp().request('/api/agent/health?token=secret-token');
    assert.equal(response.status, 401);
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

describe('apiOriginOnly', () => {
  function standaloneApp() {
    const app = new Hono();
    app.use('*', apiOriginOnly({ allowedOrigins: ['http://127.0.0.1:5173'] }));
    app.get('/api/health', (c) => c.json({ ok: true }));
    app.get('/page', (c) => c.text('ok'));
    return app;
  }

  it('checks Origin on every API path and permits only same-origin or the local dev origin', async () => {
    const app = standaloneApp();
    assert.equal((await app.request('/api/health', { headers: { Origin: 'http://localhost' } })).status, 200);
    assert.equal((await app.request('/api/health', { headers: { Origin: 'http://127.0.0.1:5173' } })).status, 200);
    assert.equal((await app.request('/api/health')).status, 403);
    assert.equal((await app.request('/api/health', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await app.request('/api', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await app.request('/page')).status, 200);
  });

  it('uses the desktop origin policy for the full API namespace', async () => {
    const app = new Hono();
    app.use('*', apiOriginOnly({ desktopOrigins: ['tauri://localhost'] }));
    app.get('/api/health', (c) => c.json({ ok: true }));
    assert.equal((await app.request('/api/health', { headers: { Origin: 'tauri://localhost' } })).status, 200);
    assert.equal((await app.request('/api/health')).status, 403);
  });
});
