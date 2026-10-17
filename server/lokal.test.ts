import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLokalEndpoint, exportSessionTrace } from './lokal.js';
import { appendMessage } from './conversations.js';

describe('detectLokalEndpoint', () => {
  it('returns null when serve.token is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'lokal-home-'));
    assert.equal(detectLokalEndpoint(home), null);
  });

  it('detects lokal endpoint when serve.token exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'lokal-home-'));
    mkdirSync(join(home, '.lokal'), { recursive: true });
    writeFileSync(join(home, '.lokal', 'serve.token'), 'test-token\n');

    const ep = detectLokalEndpoint(home);
    assert.ok(ep);
    assert.equal(ep.name, 'lokal');
    assert.equal(ep.protocol, 'openai-chat');
    assert.equal(ep.baseUrl, 'http://127.0.0.1:52140/v1');
    assert.equal(ep.credential, 'file:~/.lokal/serve.token');
    assert.equal(ep.locality, 'local');
    assert.deepEqual(ep.models, ['lokal/auto', 'lokal/qwen', 'lokal/llama']);
  });
});

describe('exportSessionTrace', () => {
  const validId = '11111111-2222-3333-4444-555555555555';

  it('rejects an invalid conversation ID', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'));
    assert.throws(() => exportSessionTrace(root, 'invalid-id'), /Invalid conversation id/);
  });

  it('rejects a nonexistent conversation', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'));
    assert.throws(() => exportSessionTrace(root, validId), /Conversation not found/);
  });

  it('exports conversation events to ~/.lokal/traces/<id>.json with mode 0600', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'));
    const home = mkdtempSync(join(tmpdir(), 'home-'));

    // Create a real conversation with messages
    appendMessage(root, 'demo-scope', validId, {
      role: 'user',
      content: 'Hello agent',
      at: '2026-10-17T12:00:00.000Z',
    });
    appendMessage(root, 'demo-scope', validId, {
      role: 'assistant',
      content: 'Hello, how can I help?',
      toolCalls: [{ name: 'read_file', status: 'done', result: 'file content' }],
      at: '2026-10-17T12:00:02.000Z',
    });

    const result = exportSessionTrace(root, validId, home);
    assert.equal(result.traceId, validId);
    assert.equal(result.path, join(home, '.lokal', 'traces', `${validId}.json`));
    assert.equal(result.eventsCount, 3); // 1 start event + 2 message events

    assert.ok(existsSync(result.path));
    const mode = statSync(result.path).mode & 0o777;
    assert.equal(mode, 0o600);

    const saved = JSON.parse(readFileSync(result.path, 'utf-8'));
    assert.equal(saved.version, '1.0');
    assert.equal(saved.id, validId);
    assert.equal(saved.scope, 'demo-scope');
    assert.equal(saved.summary.messagesCount, 2);
    assert.equal(saved.summary.toolCallsCount, 1);
    assert.equal(saved.events.length, 3);
  });
});
