import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APICallError, EmptyResponseBodyError, InvalidResponseDataError, JSONParseError, RetryError, StreamProviderError } from 'ai';
import { chatSetupError, inferenceErrorLogLine, publicInferenceError } from './inference-errors.js';

const SECRET = 'sk-live-should-never-leak';
const PROMPT = 'my private prompt about the client';

function apiError(statusCode: number | undefined, message = `Upstream said ${SECRET}`) {
  return new APICallError({
    message,
    url: `https://brain.internal:52140/v1/chat/completions?key=${SECRET}`,
    requestBodyValues: { messages: [{ role: 'user', content: PROMPT }] },
    statusCode,
    responseBody: JSON.stringify({ error: { message: `account acct-7 token ${SECRET}` } }),
    isRetryable: false,
  });
}

/** Whatever a sanitized error says, none of the upstream detail may be in it. */
function assertNoLeak(text: string) {
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /brain\.internal|acct-7|private prompt|Upstream said/);
}

describe('publicInferenceError', () => {
  const cases: Array<[number, string]> = [
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not_found'],
    [408, 'timeout'],
    [400, 'rejected'],
    [422, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [504, 'timeout'],
  ];
  for (const [status, code] of cases) {
    it(`maps an HTTP ${status} model call to ${code}, keeping only the status`, () => {
      const result = publicInferenceError(apiError(status));
      assert.equal(result.code, code);
      assert.equal(result.status, status);
      assert.match(result.message, new RegExp(`HTTP ${status}`));
      assertNoLeak(result.message);
    });
  }

  it('reports a model call that never got a response as unreachable', () => {
    const result = publicInferenceError(apiError(undefined, 'Cannot connect to API: connect ECONNREFUSED 127.0.0.1:52140'));
    assert.equal(result.code, 'unreachable');
    assert.equal(result.status, undefined);
    assert.doesNotMatch(result.message, /ECONNREFUSED|52140/);
  });

  it('looks through the retry wrapper at the last attempt', () => {
    const wrapped = new RetryError({ message: `Failed after 3 attempts. Last error: ${SECRET}`, reason: 'maxRetriesExceeded', errors: [apiError(500), apiError(503)] });
    const result = publicInferenceError(wrapped);
    assert.equal(result.code, 'unavailable');
    assert.equal(result.status, 503);
    assertNoLeak(result.message);
  });

  it('maps an error the provider sent inside the stream by its status, without its payload', () => {
    const withStatus = publicInferenceError(new StreamProviderError({ message: `overloaded ${SECRET}`, statusCode: 529, data: { secret: SECRET } }));
    assert.equal(withStatus.code, 'unavailable');
    assertNoLeak(withStatus.message);
    const withoutStatus = publicInferenceError(new StreamProviderError({ message: `bad things ${SECRET}` }));
    assert.equal(withoutStatus.code, 'failed');
    assertNoLeak(withoutStatus.message);
  });

  it('reports a malformed model response as invalid_response', () => {
    for (const error of [
      new JSONParseError({ text: `{"partial": "${SECRET}`, cause: new Error('Unexpected end') }),
      new InvalidResponseDataError({ data: { secret: SECRET }, message: `bad data ${SECRET}` }),
      new EmptyResponseBodyError({ message: 'empty' }),
    ]) {
      const result = publicInferenceError(error);
      assert.equal(result.code, 'invalid_response');
      assertNoLeak(result.message);
    }
  });

  it('tells a timeout from a cancellation', () => {
    assert.equal(publicInferenceError(new DOMException('signal timed out', 'TimeoutError')).code, 'timeout');
    assert.equal(publicInferenceError(new DOMException('This operation was aborted', 'AbortError')).code, 'cancelled');
  });

  it('never repeats the text of an unknown error or a non-error value', () => {
    for (const error of [new Error(`upstream down at http://10.0.0.5 token=${SECRET}`), { message: SECRET }, SECRET, undefined]) {
      const result = publicInferenceError(error);
      assert.equal(result.code, 'failed');
      assert.equal(result.message, 'The model request failed.');
    }
  });
});

describe('inferenceErrorLogLine', () => {
  it('names the code, status, and error class only', () => {
    const line = inferenceErrorLogLine(apiError(503));
    assert.equal(line, 'Inference error: unavailable (HTTP 503, AI_APICallError)');
    assertNoLeak(line);
  });

  it('does not echo a name that is not a plain identifier', () => {
    const odd = new Error('x');
    odd.name = `Bad ${SECRET} name`;
    const line = inferenceErrorLogLine(odd);
    assert.equal(line, 'Inference error: failed');
  });
});

describe('chatSetupError', () => {
  it('answers a model error with its sanitized message and logs only its code', () => {
    const { message, logLine } = chatSetupError(apiError(401));
    assert.equal(message, 'The model endpoint refused the credentials (HTTP 401). Check the endpoint\'s credential.');
    assert.equal(logLine, 'Inference error: unauthorized (HTTP 401, AI_APICallError)');
    assertNoLeak(message);
    assertNoLeak(logLine);
  });

  it('answers a host error with a fixed message and keeps its cause for the log', () => {
    const { message, logLine } = chatSetupError(new Error('ENOENT: no such file, open \'/srv/workspace/.local/agent/x.json\''));
    assert.equal(message, 'The chat turn could not start. The Agent-Control log has the cause.');
    assert.equal(logLine, 'Chat error: ENOENT: no such file, open \'/srv/workspace/.local/agent/x.json\'');
    assert.equal(chatSetupError('plain').message, 'The chat turn could not start. The Agent-Control log has the cause.');
  });
});
