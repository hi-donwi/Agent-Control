import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CHAT_TIMEOUTS, chatTimeouts, isBrainProfileCredential, loadEndpoints, localityOf, parseEndpoints, resolveCredential } from './endpoints.js';

describe('parseEndpoints', () => {
  const brainProfile = { id: 'agent-control', revision: `sha256:${'a'.repeat(64)}` };

  it('reads one endpoint per protocol, models included', () => {
    const endpoints = parseEndpoints({
      endpoints: {
        anthropic: { protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'env:ANTHROPIC_API_KEY', models: ['m1'] },
        xai: { protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', apiKey: 'keychain:xai' },
        openai: { protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', apiKey: 'env:OPENAI_API_KEY' },
        brain: { protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:52140/v1', apiKey: 'file:~/.brain/agent-control.token', locality: 'remote', purpose: 'agent-brain', routingProfile: brainProfile },
        mock: { protocol: 'mock', models: ['echo'] },
      },
    });
    assert.deepEqual(endpoints.map((e) => [e.name, e.protocol, e.locality]), [
      ['anthropic', 'anthropic-messages', 'remote'],
      ['xai', 'openai-chat', 'remote'],
      ['openai', 'openai-responses', 'remote'],
      ['brain', 'openai-chat', 'remote'],
      ['mock', 'mock', 'local'],
    ]);
    assert.deepEqual(endpoints[0].models, ['m1']);
    assert.deepEqual(endpoints[1].models, []);
    assert.equal(endpoints[3].purpose, 'agent-brain');
    assert.deepEqual(endpoints[3].routingProfile, brainProfile);
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
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-responses', baseUrl: 'https://a.example/v1', purpose: 'agent-brain' } } }), /purpose/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://a.example/v1', purpose: 'custom' } } }), /purpose/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'http://127.0.0.1/v1', purpose: 'agent-brain' } } }), /purpose/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://a.example/v1', purpose: 'agent-brain', routingProfile: brainProfile } } }), /apiKey/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://a.example/v1', purpose: 'agent-brain', apiKey: 'env:BRAIN_TOKEN' } } }), /routingProfile/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://a.example/v1', purpose: 'agent-brain', apiKey: 'env:BRAIN_TOKEN', routingProfile: { id: '../x', revision: brainProfile.revision } } } }), /routingProfile/);
    assert.throws(() => parseEndpoints({ endpoints: { x: { protocol: 'openai-chat', baseUrl: 'https://a.example/v1', purpose: 'agent-brain', apiKey: 'env:BRAIN_TOKEN', routingProfile: { ...brainProfile, revision: 'latest' } } } }), /routingProfile/);
  });
});

describe('isBrainProfileCredential', () => {
  it('accepts only bounded signed-profile token envelopes', () => {
    assert.equal(isBrainProfileCredential('bpi1.payload.signature'), true);
    assert.equal(isBrainProfileCredential('master-token'), false);
    assert.equal(isBrainProfileCredential('bpi1.only-one-part'), false);
    assert.equal(isBrainProfileCredential(`bpi1.${'a'.repeat(4096)}.signature`), false);
    assert.equal(isBrainProfileCredential(undefined), false);
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

describe('model-silence timeouts', () => {
  const brain = (timeouts: unknown) => ({
    endpoints: { brain: { protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:52140/v1', apiKey: 'file:~/.brain/agent-control.token', locality: 'remote', purpose: 'agent-brain', routingProfile: { id: 'agent-control', revision: `sha256:${'a'.repeat(64)}` }, timeouts } },
  });

  it('reads an endpoint override in whole milliseconds, either field alone', () => {
    assert.deepEqual(parseEndpoints(brain({ firstChunkMs: 600_000, chunkMs: 300_000 }))[0].timeouts, { firstChunkMs: 600_000, chunkMs: 300_000 });
    assert.deepEqual(parseEndpoints(brain({ chunkMs: 250 }))[0].timeouts, { chunkMs: 250 });
    assert.equal(parseEndpoints(brain(undefined))[0].timeouts, undefined);
  });

  it('refuses a timeout that is not a whole number of milliseconds up to an hour, or a misspelt field', () => {
    for (const timeouts of [{ firstChunkMs: 0 }, { chunkMs: -5 }, { chunkMs: 1.5 }, { chunkMs: '60000' }, { chunkMs: 3_600_001 }, { chunkMS: 1000 }, [1000], 'fast']) {
      assert.throws(() => parseEndpoints(brain(timeouts)), /timeouts/, JSON.stringify(timeouts));
    }
  });

  it('falls back to the defaults field by field', () => {
    assert.deepEqual(chatTimeouts(undefined), { firstChunkMs: DEFAULT_CHAT_TIMEOUTS.firstChunkMs, chunkMs: DEFAULT_CHAT_TIMEOUTS.chunkMs });
    const [endpoint] = parseEndpoints(brain({ chunkMs: 250 }));
    assert.deepEqual(chatTimeouts(endpoint), { firstChunkMs: DEFAULT_CHAT_TIMEOUTS.firstChunkMs, chunkMs: 250 });
  });

  it('waits longer between chunks than the longest chat tool runs, since the timer runs through tool execution', () => {
    // run_command and git tools stop at 30 s, diagnostics at 60 s (server/tools/*.ts).
    assert.ok(DEFAULT_CHAT_TIMEOUTS.chunkMs > 60_000);
    assert.ok(DEFAULT_CHAT_TIMEOUTS.firstChunkMs >= DEFAULT_CHAT_TIMEOUTS.chunkMs);
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

  it('auto-discovers lokal endpoint only when a scoped credential and profile manifest exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-endpoints-'));
    const home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    mkdirSync(join(home, '.lokal'), { recursive: true });
    writeFileSync(join(home, '.lokal', 'agent-control.token'), 'scoped-token\n');
    writeFileSync(join(home, '.lokal', 'agent-control.token.json'), JSON.stringify({ id: 'agent-control', revision: `sha256:${'a'.repeat(64)}` }));

    const endpoints = loadEndpoints(root, { autoDiscoverLokal: true, home });
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].name, 'lokal');
    assert.equal(endpoints[0].locality, 'remote');
    assert.equal(endpoints[0].purpose, 'agent-brain');
    assert.deepEqual(endpoints[0].routingProfile, { id: 'agent-control', revision: `sha256:${'a'.repeat(64)}` });
  });

  it('does not auto-discover from the gateway master token', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-endpoints-'));
    const home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    mkdirSync(join(home, '.lokal'), { recursive: true });
    writeFileSync(join(home, '.lokal', 'serve.token'), 'master-token\n');
    assert.deepEqual(loadEndpoints(root, { autoDiscoverLokal: true, home }), []);
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
