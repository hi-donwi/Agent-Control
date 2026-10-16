import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSse } from './sse';

describe('parseSse', () => {
  it('reads complete messages and keeps the unfinished rest', () => {
    const { messages, rest } = parseSse('event: floor\ndata: {"a":1}\n\nevent: ping\ndata: \n\nevent: flo');
    assert.deepEqual(messages, [{ event: 'floor', data: '{"a":1}' }, { event: 'ping', data: '' }]);
    assert.equal(rest, 'event: flo');
  });

  it('joins multi-line data, skips comments, and accepts CRLF', () => {
    const { messages } = parseSse(': keep-alive\r\ndata: one\r\ndata: two\r\n\r\n');
    assert.deepEqual(messages, [{ event: 'message', data: 'one\ntwo' }]);
  });

  it('drops a block with nothing in it', () => {
    assert.deepEqual(parseSse(': only a comment\n\n').messages, []);
  });
});
