import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBrainModels } from './brain-models.js';
import type { Endpoint } from './endpoints.js';

const brain: Endpoint = {
  name: 'agent-brain',
  protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:52140/v1',
  credential: 'file:~/.brain/agent-control.token',
  locality: 'remote',
  models: [],
  purpose: 'agent-brain',
  routingProfile: { id: 'agent-control', revision: `sha256:${'a'.repeat(64)}` },
};

describe('discoverBrainModels', () => {
  it('reads authenticated model IDs from the OpenAI-compatible gateway', async () => {
    let requestedUrl = '';
    let authorization = '';
    let profile = '';
    let revision = '';
    let redirect = '';
    const models = await discoverBrainModels(brain, 'bpi1.payload.signature', async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      profile = new Headers(init?.headers).get('x-brain-profile') ?? '';
      revision = new Headers(init?.headers).get('x-brain-revision') ?? '';
      redirect = init?.redirect ?? '';
      return Response.json({ data: [{ id: 'chat' }, { id: 'anthropic/claude-sonnet' }, { id: '' }, { id: 'chat' }] });
    });

    assert.equal(requestedUrl, 'http://127.0.0.1:52140/v1/models');
    assert.equal(authorization, 'Bearer bpi1.payload.signature');
    assert.equal(profile, 'agent-control');
    assert.equal(revision, brain.routingProfile?.revision);
    assert.equal(redirect, 'error');
    assert.deepEqual(models, ['chat', 'anthropic/claude-sonnet']);
  });

  it('does not leak the gateway credential in upstream errors', async () => {
    await assert.rejects(
      discoverBrainModels(brain, 'bpi1.payload.signature', async () => new Response('private upstream detail', { status: 503 })),
      (error: Error) => /503/.test(error.message) && !error.message.includes('bpi1.payload.signature') && !error.message.includes('private upstream detail'),
    );
  });

  it('rejects malformed model-list responses without echoing response content', async () => {
    await assert.rejects(
      discoverBrainModels(brain, 'bpi1.payload.signature', async () => Response.json({ error: 'private upstream detail' })),
      (error: Error) => /invalid model list/.test(error.message) && !error.message.includes('private upstream detail'),
    );
  });

  it('bounds model metadata responses', async () => {
    await assert.rejects(
      discoverBrainModels(brain, 'bpi1.payload.signature', async () => new Response(new Uint8Array(1024 * 1024 + 1))),
      /invalid model list/,
    );
  });

  it('rejects the master credential before contacting Brain', async () => {
    let requested = false;
    await assert.rejects(discoverBrainModels(brain, 'master-token', async () => {
      requested = true;
      return Response.json({ data: [] });
    }), /profile-scoped credential/);
    assert.equal(requested, false);
  });
});
