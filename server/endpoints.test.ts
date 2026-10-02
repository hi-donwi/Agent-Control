import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
    assert.throws(
      () => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', apiKey: 'xai-SECRET123' } } }),
      (error: Error) => /must be a reference/.test(error.message) && !error.message.includes('SECRET123'),
    );
  });

  it('refuses an unknown protocol, a bad name, and a missing base URL', () => {
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'grpc', baseUrl: 'https://a.example' } } }), /protocol/);
    assert.throws(() => parseEndpoints({ endpoints: { 'Bad Name': { protocol: 'mock' } } }), /name/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat' } } }), /baseUrl/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'file:///etc/passwd' } } }), /baseUrl/);
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
