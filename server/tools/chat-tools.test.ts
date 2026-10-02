import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { streamText } from 'ai';
import { createChatTools } from './chat-tools.js';
import { WorkspaceBridge } from './workspace.js';
import { createMockModel } from '../providers/mock.js';

describe('createChatTools', () => {
  it('declares every tool so a chat runs at all', async () => {
    // Plain-object parameters are read as zod schemas by AI SDK 4 and threw on every
    // request ("Cannot read properties of undefined (reading 'typeName')").
    const tools = createChatTools(new WorkspaceBridge('/nonexistent-workspace'));
    assert.ok(Object.keys(tools).length >= 10);
    const result = streamText({
      model: createMockModel('echo'),
      messages: [{ role: 'user', content: 'ping' }],
      tools,
      maxSteps: 5,
    });
    let text = '';
    let error: unknown;
    for await (const part of result.fullStream) {
      if (part.type === 'error') error = part.error;
      if (part.type === 'text-delta') text += part.textDelta;
    }
    assert.equal(error, undefined);
    assert.equal(text, 'mock(echo): ping');
  });
});
