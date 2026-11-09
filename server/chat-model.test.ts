import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { generateText, streamText } from 'ai';
import { chatDefaults, isChatEndpoint, resolveChatModel } from './chat-model.js';
import { createEndpointModel } from './providers/endpoint-model.js';
import type { Endpoint } from './endpoints.js';

const xai: Endpoint = { name: 'xai', protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', credential: 'env:XAI_API_KEY', locality: 'remote', models: [] };
const mock: Endpoint = { name: 'mock', protocol: 'mock', locality: 'local', models: ['echo'] };
const brain: Endpoint = {
  name: 'brain', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:52140/v1', credential: 'env:BRAIN_TOKEN',
  locality: 'remote', purpose: 'agent-brain', models: [], routingProfile: { id: 'agent-control', revision: `sha256:${'a'.repeat(64)}` },
};
/** A model server on loopback reached directly, not through Brain. */
const ollama: Endpoint = { name: 'ollama', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:11434/v1', locality: 'local', models: [] };

describe('createEndpointModel', () => {
  it('maps each wire protocol to its SDK model', () => {
    const remote = { locality: 'remote' as const, models: [] as string[] };
    assert.equal(createEndpointModel({ ...remote, name: 'a', protocol: 'openai-chat', baseUrl: 'https://a.example/v1' }, 'm', 'k').provider, 'a.chat');
    assert.equal(createEndpointModel({ ...remote, name: 'b', protocol: 'openai-responses', baseUrl: 'https://b.example/v1' }, 'm', 'k').provider, 'openai.responses');
    assert.equal(createEndpointModel({ ...remote, name: 'c', protocol: 'anthropic-messages', baseUrl: 'https://c.example/v1' }, 'm', 'k').provider, 'anthropic.messages');
    assert.equal(createEndpointModel(mock, 'echo').provider, 'mock');
  });
});

describe('mock model', () => {
  it('answers deterministically, generated and streamed, with no network', async () => {
    const model = createEndpointModel(mock, 'echo');
    const { text } = await generateText({ model, prompt: 'hello' });
    assert.equal(text, 'mock(echo): hello');
    let streamed = '';
    for await (const delta of streamText({ model, prompt: 'hi there' }).textStream) streamed += delta;
    assert.equal(streamed, 'mock(echo): hi there');
  });
});

describe('isChatEndpoint', () => {
  it('admits Agent Brain and the offline mock, and nothing else', () => {
    assert.equal(isChatEndpoint(brain), true);
    assert.equal(isChatEndpoint(mock), true);
    assert.equal(isChatEndpoint(xai), false);
    assert.equal(isChatEndpoint(ollama), false);
  });
});

describe('resolveChatModel', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-chat-'));
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'policies', 'demo.json'),
    JSON.stringify({ schema_version: 1, default: 'read', llm: { endpoints: ['brain', 'xai'], brain_profiles: [{ endpoint: 'brain', profile_id: 'agent-control', revision: brain.routingProfile!.revision }] } }));
  const deps = { root, endpoints: [brain, xai, ollama, mock], env: { BRAIN_TOKEN: 'bpi1.payload.signature', XAI_API_KEY: 'k' } };

  it('uses the offline mock without a project', () => {
    const result = resolveChatModel({ provider: 'mock', model: 'echo' }, deps);
    assert.ok('model' in result && result.model.provider === 'mock');
  });

  it('uses Agent Brain only for a project whose policy lists it', () => {
    const allowed = resolveChatModel({ provider: 'brain', model: 'm', project: 'demo' }, deps);
    assert.ok('model' in allowed && allowed.model.provider === 'brain.chat' && allowed.locality === 'remote');
    const noProject = resolveChatModel({ provider: 'brain', model: 'm' }, deps);
    assert.ok('status' in noProject && noProject.status === 403);
    const otherProject = resolveChatModel({ provider: 'brain', model: 'm', project: 'other' }, deps);
    assert.ok('status' in otherProject && otherProject.status === 403);
  });

  it('refuses an endpoint that is not Agent Brain, even when the policy lists it', () => {
    const remote = resolveChatModel({ provider: 'xai', model: 'm', project: 'demo' }, deps);
    assert.ok('status' in remote && remote.status === 400 && /not an Agent Brain endpoint/.test(remote.error));
    const loopback = resolveChatModel({ provider: 'ollama', model: 'm' }, deps);
    assert.ok('status' in loopback && loopback.status === 400 && /not an Agent Brain endpoint/.test(loopback.error));
  });

  it('reports a missing credential by name', () => {
    const result = resolveChatModel({ provider: 'brain', model: 'm', project: 'demo' }, { ...deps, env: {} });
    assert.ok('status' in result && result.status === 400 && /BRAIN_TOKEN is not set/.test(result.error));
  });

  it('rejects the gateway master token before creating a Brain model', () => {
    const result = resolveChatModel({ provider: 'brain', model: 'm', project: 'demo' }, { ...deps, env: { BRAIN_TOKEN: 'master-token' } });
    assert.ok('status' in result && result.status === 400 && /profile-scoped credential/.test(result.error));
  });

  it('sends the configured profile ID and revision on every inference request', async () => {
    const headers = new Map<string, string>();
    const server = createServer((request, response) => {
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(name.toLowerCase(), value);
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    try {
      const endpoint = { ...brain, baseUrl: `http://127.0.0.1:${address.port}/v1` };
      const resolved = resolveChatModel({ provider: 'brain', model: 'm', project: 'demo' }, { ...deps, endpoints: [endpoint, xai, ollama, mock] });
      assert.ok('model' in resolved);
      const result = await generateText({ model: resolved.model, prompt: 'test' });
      assert.equal(result.text, 'ok');
      assert.equal(headers.get('x-brain-profile'), brain.routingProfile?.id);
      assert.equal(headers.get('x-brain-revision'), brain.routingProfile?.revision);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects a project key that is a path', () => {
    const result = resolveChatModel({ provider: 'brain', model: 'm', project: '../x' }, deps);
    assert.ok('status' in result && result.status === 400);
  });

  it('names an unknown endpoint and points at Agent Brain, not at API keys', () => {
    for (const provider of ['nope', 'openai', 'anthropic', 'google']) {
      const unknown = resolveChatModel({ provider, model: 'm' }, deps);
      assert.ok('status' in unknown && unknown.status === 400);
      assert.match(unknown.error, new RegExp(`"${provider}"`));
      assert.match(unknown.error, /Agent Brain/);
      assert.doesNotMatch(unknown.error, /API key/);
    }
  });
});

describe('chatDefaults', () => {
  const brainWithModels: Endpoint = { ...brain, models: ['auto', 'fast'] };

  it('keeps the configured endpoint and model when the endpoint can chat', () => {
    assert.deepEqual(chatDefaults({ defaultProvider: 'brain', defaultModel: 'fast' }, [mock, brainWithModels]),
      { provider: 'brain', model: 'fast' });
    assert.deepEqual(chatDefaults({ defaultProvider: 'brain', defaultModel: '' }, [brainWithModels]),
      { provider: 'brain', model: 'auto' });
  });

  it('prefers Agent Brain over mock when the configured default cannot chat', () => {
    for (const defaultProvider of ['anthropic', 'xai', '']) {
      assert.deepEqual(chatDefaults({ defaultProvider, defaultModel: 'claude-sonnet-4-20250514' }, [xai, mock, brainWithModels]),
        { provider: 'brain', model: 'auto' });
    }
    assert.deepEqual(chatDefaults({ defaultProvider: 'anthropic', defaultModel: 'x' }, [xai, mock]), { provider: 'mock', model: 'echo' });
    assert.deepEqual(chatDefaults({ defaultProvider: 'anthropic', defaultModel: 'x' }, [xai]), { provider: '', model: '' });
  });
});
