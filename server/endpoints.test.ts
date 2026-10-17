import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEndpoints, localityOf, parseEndpoints, resolveCredential } from './endpoints.js';

describe('parseEndpoints', () => {
  it('reads one endpoint per protocol, models included', () => {
    const endpoints = parseEndpoints({
      endpoints: {
        anthropic: { protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'env:ANTHROPIC_API_KEY', models: ['m1'] },
        xai: { protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', apiKey: 'keychain:xai' },
        openai: { protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', apiKey: 'env:OPENAI_API_KEY' },
        mock: { protocol: 'mock', models: ['echo'] },
      },
    });
    assert.deepEqual(endpoints.map((e) => [e.name, e.protocol, e.locality]), [
      ['anthropic', 'anthropic-messages', 'remote'],
      ['xai', 'openai-chat', 'remote'],
      ['openai', 'openai-responses', 'remote'],
      ['mock', 'mock', 'local'],
    ]);
    assert.deepEqual(endpoints[0].models, ['m1']);
    assert.deepEqual(endpoints[1].models, []);
  });

  it('refuses a literal key and does not repeat it', () => {
    // A low-entropy stand-in: a realistic-looking key here is what secret scanners flag.
    const literal = 'plain-text-value';
    assert.throws(
      () => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', apiKey: literal } } }),
      (error: Error) => /must be a reference/.test(error.message) && !error.message.includes(literal),
    );
  });

  it('refuses an unknown protocol, a bad name, and a missing base URL', () => {
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'grpc', baseUrl: 'https://a.example' } } }), /protocol/);
    assert.throws(() => parseEndpoints({ endpoints: { 'Bad Name': { protocol: 'mock' } } }), /name/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat' } } }), /baseUrl/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'file:///etc/passwd' } } }), /baseUrl/);
  });
});

describe('file credentials and declared locality', () => {
  const gateway = { protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:52140/v1' };

  it('accepts an absolute or home file reference and refuses a relative or escaping one', () => {
    assert.equal(parseEndpoints({ endpoints: { b: { ...gateway, apiKey: 'file:~/.lokal/serve.token' } } })[0].credential, 'file:~/.lokal/serve.token');
    assert.equal(parseEndpoints({ endpoints: { b: { ...gateway, apiKey: 'file:/etc/brain/token' } } })[0].credential, 'file:/etc/brain/token');
    assert.throws(() => parseEndpoints({ endpoints: { b: { ...gateway, apiKey: 'file:token' } } }), /must be a reference/);
    assert.throws(() => parseEndpoints({ endpoints: { b: { ...gateway, apiKey: 'file:~/../../etc/passwd' } } }), /must be a reference/);
  });

  it('lets a loopback gateway be declared remote, and never a remote URL local', () => {
    assert.equal(parseEndpoints({ endpoints: { b: { ...gateway, locality: 'remote' } } })[0].locality, 'remote');
    assert.equal(parseEndpoints({ endpoints: { b: { ...gateway, locality: 'local' } } })[0].locality, 'local');
    assert.equal(parseEndpoints({ endpoints: { b: gateway } })[0].locality, 'local');
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', locality: 'local' } } }), /never local/);
    assert.throws(() => parseEndpoints({ endpoints: { b: { ...gateway, locality: 'nearby' } } }), /locality/);
  });

  it('reads a token file only when its owner alone can read it', () => {
    const home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    mkdirSync(join(home, '.lokal'));
    const token = join(home, '.lokal', 'serve.token');
    writeFileSync(token, 'gateway-token\n');
    chmodSync(token, 0o600);
    assert.equal(resolveCredential('file:~/.lokal/serve.token', { env: {}, home }), 'gateway-token');
    chmodSync(token, 0o644);
    assert.throws(() => resolveCredential('file:~/.lokal/serve.token', { env: {}, home }), /readable only by its owner/);
    assert.throws(() => resolveCredential('file:~/.lokal/missing', { env: {}, home }), /does not exist/);
  });
});

describe('localityOf', () => {
  it('is derived from the URL: loopback is local, everything else remote', () => {
    assert.equal(localityOf('http://127.0.0.1:11434/v1'), 'local');
    assert.equal(localityOf('http://localhost:1234/v1'), 'local');
    assert.equal(localityOf('http://[::1]:8080/v1'), 'local');
    assert.equal(localityOf('http://192.168.1.10:11434/v1'), 'remote');
    assert.equal(localityOf('https://api.x.ai/v1'), 'remote');
    assert.equal(localityOf('http://localhost.example.com/v1'), 'remote');
  });
});

describe('loadEndpoints', () => {
  it('reads .local/agent/endpoints.json under the workspace root, or nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-endpoints-'));
    assert.deepEqual(loadEndpoints(root), []);
    mkdirSync(join(root, '.local', 'agent'), { recursive: true });
    writeFileSync(join(root, '.local', 'agent', 'endpoints.json'), JSON.stringify({ endpoints: { mock: { protocol: 'mock' } } }));
    assert.deepEqual(loadEndpoints(root).map((e) => e.name), ['mock']);
  });

  it('auto-discovers lokal endpoint when requested and serve.token exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-endpoints-'));
    const home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    mkdirSync(join(home, '.lokal'), { recursive: true });
    writeFileSync(join(home, '.lokal', 'serve.token'), 'token\n');

    const endpoints = loadEndpoints(root, { autoDiscoverLokal: true, home });
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].name, 'lokal');
    assert.equal(endpoints[0].locality, 'local');
  });
});

describe('resolveCredential', () => {
  it('reads env references and keychain references through the given readers', () => {
    assert.equal(resolveCredential('env:K', { env: { K: 'v' } }), 'v');
    assert.equal(resolveCredential('keychain:svc', { env: {}, keychain: (name) => `kc-${name}` }), 'kc-svc');
    assert.equal(resolveCredential(undefined, { env: {} }), undefined);
  });

  it('says which variable is missing, never a value', () => {
    assert.throws(() => resolveCredential('env:MISSING_KEY', { env: {} }), /MISSING_KEY is not set/);
  });
});
