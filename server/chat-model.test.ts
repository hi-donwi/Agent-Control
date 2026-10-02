import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, streamText } from 'ai';
import { resolveChatModel } from './chat-model.js';
import { createEndpointModel } from './providers/endpoint-model.js';
import type { Endpoint } from './endpoints.js';
import type { ProviderAdapter } from './providers/types.js';

const xai: Endpoint = { name: 'xai', protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', credential: 'env:XAI_API_KEY', locality: 'remote', models: [] };
const mock: Endpoint = { name: 'mock', protocol: 'mock', locality: 'local', models: ['echo'] };

describe('createEndpointModel', () => {
  it('maps each wire protocol to its SDK model', () => {
    const remote = { locality: 'remote' as const, models: [] as string[] };
    assert.equal(createEndpointModel({ ...remote, name: 'a', protocol: 'openai-chat', baseUrl: 'https://a.example/v1' }, 'm', 'k').provider, 'openai.chat');
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

describe('resolveChatModel', () => {
  const legacy: ProviderAdapter = { name: 'Legacy', model: () => createEndpointModel(mock, 'legacy'), models: () => ['legacy'] };
  const adapters = new Map([['legacy', legacy]]);
  const root = mkdtempSync(join(tmpdir(), 'ac-chat-'));
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'policies', 'demo.json'),
    JSON.stringify({ schema_version: 1, default: 'read', llm: { endpoints: ['xai'] } }));
  const deps = { root, endpoints: [xai, mock], adapters, env: { XAI_API_KEY: 'k' } };

  it('uses a local endpoint without a project', () => {
    const result = resolveChatModel({ provider: 'mock', model: 'echo' }, deps);
    assert.ok('model' in result && result.model.provider === 'mock');
  });

  it('uses a remote endpoint only for a project whose policy lists it', () => {
    const allowed = resolveChatModel({ provider: 'xai', model: 'm', project: 'demo' }, deps);
    assert.ok('model' in allowed && allowed.model.provider === 'openai.chat');
    const noProject = resolveChatModel({ provider: 'xai', model: 'm' }, deps);
    assert.ok('status' in noProject && noProject.status === 403);
    const otherProject = resolveChatModel({ provider: 'xai', model: 'm', project: 'other' }, deps);
    assert.ok('status' in otherProject && otherProject.status === 403);
  });

  it('reports a missing credential by name', () => {
    const result = resolveChatModel({ provider: 'xai', model: 'm', project: 'demo' }, { ...deps, env: {} });
    assert.ok('status' in result && result.status === 400 && /XAI_API_KEY is not set/.test(result.error));
  });

  it('rejects a project key that is a path', () => {
    const result = resolveChatModel({ provider: 'xai', model: 'm', project: '../x' }, deps);
    assert.ok('status' in result && result.status === 400);
  });

  it('still serves legacy providers, and names an unknown one', () => {
    const result = resolveChatModel({ provider: 'legacy', model: 'legacy' }, deps);
    assert.ok('model' in result && result.model.modelId === 'legacy');
    const unknown = resolveChatModel({ provider: 'nope', model: 'm' }, deps);
    assert.ok('status' in unknown && unknown.status === 400 && /nope/.test(unknown.error));
  });
});
