import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBrainModels } from './brain-models.js';
import type { Endpoint } from './endpoints.js';

const brain: Endpoint = {
  name: 'agent-brain',
  protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:52140/v1',
  credential: 'file:~/.brain/serve.token',
  locality: 'remote',
  models: [],
  purpose: 'agent-brain',
};

describe('discoverBrainModels', () => {
  it('reads authenticated model IDs from the OpenAI-compatible gateway', async () => {
    let requestedUrl = '';
    let authorization = '';
    let redirect = '';
    const models = await discoverBrainModels(brain, 'gateway-secret', async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      redirect = init?.redirect ?? '';
      return Response.json({ data: [{ id: 'chat' }, { id: 'anthropic/claude-sonnet' }, { id: '' }, { id: 'chat' }] });
    });

    assert.equal(requestedUrl, 'http://127.0.0.1:52140/v1/models');
    assert.equal(authorization, 'Bearer gateway-secret');
    assert.equal(redirect, 'error');
    assert.deepEqual(models, ['chat', 'anthropic/claude-sonnet']);
  });

  it('does not leak the gateway credential in upstream errors', async () => {
    await assert.rejects(
      discoverBrainModels(brain, 'gateway-secret', async () => new Response('private upstream detail', { status: 503 })),
      (error: Error) => /503/.test(error.message) && !error.message.includes('gateway-secret') && !error.message.includes('private upstream detail'),
    );
  });

  it('rejects malformed model-list responses without echoing response content', async () => {
    await assert.rejects(
      discoverBrainModels(brain, undefined, async () => Response.json({ error: 'private upstream detail' })),
      (error: Error) => /invalid model list/.test(error.message) && !error.message.includes('private upstream detail'),
    );
  });

  it('bounds model metadata responses', async () => {
    await assert.rejects(
      discoverBrainModels(brain, undefined, async () => new Response(new Uint8Array(1024 * 1024 + 1))),
      /invalid model list/,
    );
  });
});
