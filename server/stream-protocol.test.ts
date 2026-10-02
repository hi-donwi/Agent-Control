import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jsonSchema, stepCountIs, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { toLineStream } from './stream-protocol.js';
import { createMockModel } from './providers/mock.js';

async function lines(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  return (await new Response(stream).text()).split('\n').filter(Boolean);
}

const STOP = { unified: 'stop' as const, raw: undefined };
const CALLS = { unified: 'tool-calls' as const, raw: undefined };
const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

describe('toLineStream', () => {
  it('turns a streamed answer into the line protocol the UI reads', async () => {
    const result = streamText({ model: createMockModel('echo'), prompt: 'hello there' });
    const out = await lines(toLineStream(result.fullStream));
    const text = out.filter((l) => l.startsWith('0:')).map((l) => JSON.parse(l.slice(2))).join('');
    assert.equal(text, 'mock(echo): hello there');
    assert.ok(out.at(-1)?.startsWith('d:'));
    assert.equal(JSON.parse(out.at(-1)!.slice(2)).finishReason, 'stop');
  });

  it('reports a tool call and its result, then the answer that follows', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        { stream: new ReadableStream({ start(c) {
          c.enqueue({ type: 'tool-call', toolCallId: 'c1', toolName: 'ping', input: '{}' });
          c.enqueue({ type: 'finish', finishReason: CALLS, usage: USAGE });
          c.close();
        } }) },
        { stream: new ReadableStream({ start(c) {
          c.enqueue({ type: 'text-start', id: 't' });
          c.enqueue({ type: 'text-delta', id: 't', delta: 'done' });
          c.enqueue({ type: 'text-end', id: 't' });
          c.enqueue({ type: 'finish', finishReason: STOP, usage: USAGE });
          c.close();
        } }) },
      ],
    });
    const result = streamText({
      model,
      prompt: 'call ping',
      tools: { ping: { inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => 'pong' } },
      stopWhen: stepCountIs(3),
    });
    const out = await lines(toLineStream(result.fullStream));
    const kinds = out.map((l) => l[0]).join('');
    assert.match(kinds, /9a.*0.*d$/);
    assert.deepEqual(JSON.parse(out.find((l) => l.startsWith('a:'))!.slice(2)), { toolCallId: 'c1', result: 'pong' });
  });

  it('turns a failed stream into an e: line instead of breaking the response', async () => {
    const failing = new MockLanguageModelV4({ doStream: async () => { throw new Error('upstream down'); } });
    const out = await lines(toLineStream(streamText({ model: failing, prompt: 'x' }).fullStream));
    assert.ok(out.some((l) => l.startsWith('e:') && JSON.parse(l.slice(2)).includes('upstream down')));
  });
});
