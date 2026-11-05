import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APICallError, jsonSchema, stepCountIs, streamText, type TextStreamPart, type ToolSet } from 'ai';
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

  it('reports the finish reason and token totals once, for the usage record', async () => {
    const finishes: Array<{ finishReason: string; tokens: { input: number; output: number } }> = [];
    const result = streamText({ model: createMockModel('echo'), prompt: 'count me' });
    await lines(toLineStream(result.fullStream, (finish) => finishes.push(finish)));
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].finishReason, 'stop');
    assert.equal(finishes[0].tokens.output, 'mock(echo): count me'.length);
  });

  it('turns a failed stream into a sanitized e: line instead of breaking the response', async () => {
    const failing = new MockLanguageModelV4({ doStream: async () => { throw new Error('upstream down, token sk-secret'); } });
    const out = await lines(toLineStream(streamText({ model: failing, prompt: 'x', onError: () => {} }).fullStream));
    const errors = out.filter((l) => l.startsWith('e:')).map((l) => JSON.parse(l.slice(2)) as string);
    assert.deepEqual(errors, ['The model request failed.']);
  });

  it('keeps the upstream status but not the upstream body of a failed model call', async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          message: 'Bad gateway from acct-7', url: 'http://127.0.0.1:52140/v1/chat/completions',
          requestBodyValues: { prompt: 'private prompt' }, statusCode: 502, responseBody: '{"error":"sk-secret"}', isRetryable: false,
        });
      },
    });
    const out = await lines(toLineStream(streamText({ model: failing, prompt: 'x', maxRetries: 0, onError: () => {} }).fullStream));
    const text = out.join('\n');
    assert.match(text, /e:"The model endpoint failed \(HTTP 502\)\. Try again\."/);
    assert.doesNotMatch(text, /acct-7|52140|private prompt|sk-secret/);
  });

  it('ends a turn stopped through the abort signal without an error or a done line, and reports the finished steps', async () => {
    const controller = new AbortController();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        calls += 1;
        if (calls === 1) {
          return { stream: new ReadableStream({ start(c) {
            c.enqueue({ type: 'tool-call', toolCallId: 'c1', toolName: 'ping', input: '{}' });
            c.enqueue({ type: 'finish', finishReason: CALLS, usage: USAGE });
            c.close();
          } }) };
        }
        // The second step streams one word, then waits for a stop that only the abort brings.
        return { stream: new ReadableStream({ start(c) {
          c.enqueue({ type: 'text-start', id: 't' });
          c.enqueue({ type: 'text-delta', id: 't', delta: 'partial' });
          abortSignal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')), { once: true });
        } }) };
      },
    });
    const finishes: Array<{ finishReason: string; tokens: { input: number; output: number } }> = [];
    const result = streamText({
      model, prompt: 'x', abortSignal: controller.signal, stopWhen: stepCountIs(3),
      tools: { ping: { inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => 'pong' } },
    });
    const reader = toLineStream(result.fullStream, (finish) => finishes.push(finish), { clientSignal: controller.signal }).getReader();
    const decoder = new TextDecoder();
    let seen = '';
    while (!seen.includes('0:"partial"')) {
      const { value, done } = await reader.read();
      assert.equal(done, false, `stream ended before the partial answer: ${seen}`);
      seen += decoder.decode(value);
    }
    controller.abort();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
    const kinds = seen.split('\n').filter(Boolean).map((l) => l[0]);
    assert.ok(!kinds.includes('e'), seen);
    assert.ok(!kinds.includes('d'), seen);
    assert.deepEqual(finishes.map((f) => [f.finishReason, f.tokens.input, f.tokens.output]), [['abort', 1, 1]]);
  });

  it('reports a turn stopped by a model-silence timeout as a timeout, not as a silent stop', async () => {
    const model = new MockLanguageModelV4({
      // Accepts the request and then sends nothing, as a stuck gateway would.
      doStream: async ({ abortSignal }) => ({ stream: new ReadableStream({ start(c) {
        c.enqueue({ type: 'stream-start', warnings: [] });
        abortSignal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')), { once: true });
      } }) }),
    });
    const client = new AbortController();
    const finishes: Array<{ finishReason: string; tokens: { input: number; output: number } }> = [];
    const result = streamText({ model, prompt: 'x', timeout: { firstChunkMs: 50 }, onError: () => {} });
    const out = await lines(toLineStream(result.fullStream, (finish) => finishes.push(finish), { clientSignal: client.signal }));
    assert.deepEqual(out.filter((l) => l.startsWith('e:')).map((l) => JSON.parse(l.slice(2)) as string), ['The model request timed out.']);
    assert.ok(!out.some((l) => l.startsWith('d:')), out.join('\n'));
    assert.deepEqual(finishes.map((f) => [f.finishReason, f.tokens.input, f.tokens.output]), [['timeout', 0, 0]]);
  });

  it('stops reading its source when the reader cancels', async () => {
    let pulled = 0;
    let returned!: () => void;
    const sourceReturned = new Promise<void>((resolve) => { returned = resolve; });
    async function* source(): AsyncGenerator<TextStreamPart<ToolSet>> {
      try {
        for (const text of ['one', 'two', 'three', 'four']) {
          pulled += 1;
          yield { type: 'text-delta', id: 't', text } as TextStreamPart<ToolSet>;
        }
      } finally {
        returned();
      }
    }
    const reader = toLineStream(source()).getReader();
    // Nobody reads yet: the stream pulls only what it can hold, it does not drain the model.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pulled <= 1, `source drained without a reader (${pulled} parts)`);
    assert.equal(new TextDecoder().decode((await reader.read()).value), '0:"one"\n');
    await reader.cancel();
    await sourceReturned;
    assert.ok(pulled < 4, `source was drained after cancel (${pulled} parts)`);
  });
});
