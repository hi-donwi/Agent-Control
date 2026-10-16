import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORKSPACE_SCOPE,
  appendMessage,
  captureAssistant,
  isScope,
  latestConversation,
  listConversations,
  openConversation,
  readConversation,
  type StoredMessage,
} from './conversations.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const user = (content: string): StoredMessage => ({ role: 'user', content, at: '2026-10-16T10:00:00.000Z' });

describe('conversation history', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ac-history-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('starts a log with its scope, then appends messages, private to the user', () => {
    appendMessage(root, 'alpha', A, user('hello'));
    appendMessage(root, 'alpha', A, { role: 'assistant', content: 'hi', at: '2026-10-16T10:00:01.000Z' });
    const path = join(root, '.local', 'agent', 'sessions', A, 'events.jsonl');
    const lines = readFileSync(path, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    assert.deepEqual(lines.map((l) => l.type), ['start', 'message', 'message']);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readConversation(root, A), {
      scope: 'alpha',
      messages: [user('hello'), { role: 'assistant', content: 'hi', at: '2026-10-16T10:00:01.000Z' }],
    });
  });

  it('refuses a message for another scope, an invalid id, and an invalid scope', () => {
    appendMessage(root, 'alpha', A, user('hello'));
    assert.throws(() => appendMessage(root, 'beta', A, user('leak')), /another scope/);
    assert.throws(() => appendMessage(root, 'alpha', '../escape', user('x')), /invalid conversation id/);
    assert.throws(() => appendMessage(root, '../x', B, user('x')), /invalid scope/);
    assert.equal(readConversation(root, A)!.messages.length, 1);
  });

  it('finds the latest conversation of a scope and ignores other scopes', () => {
    appendMessage(root, 'alpha', A, user('old'));
    appendMessage(root, 'beta', B, user('other project'));
    appendMessage(root, 'alpha', C, user('new'));
    const sessions = join(root, '.local', 'agent', 'sessions');
    utimesSync(join(sessions, A, 'events.jsonl'), new Date('2026-10-16T09:00:00Z'), new Date('2026-10-16T09:00:00Z'));
    utimesSync(join(sessions, C, 'events.jsonl'), new Date('2026-10-16T10:00:00Z'), new Date('2026-10-16T10:00:00Z'));
    assert.deepEqual(latestConversation(root, 'alpha'), { id: C, messages: [user('new')] });
    assert.equal(latestConversation(root, WORKSPACE_SCOPE), null);
  });

  it('lists the conversations of a scope newest first, titled by their first question', () => {
    appendMessage(root, 'alpha', A, user('  How does   the export\nwork?  '));
    appendMessage(root, 'alpha', A, { role: 'assistant', content: 'It streams.', at: '2026-10-16T10:00:01.000Z' });
    appendMessage(root, 'beta', B, user('other project'));
    appendMessage(root, 'alpha', C, user('x'.repeat(120)));
    const sessions = join(root, '.local', 'agent', 'sessions');
    utimesSync(join(sessions, A, 'events.jsonl'), new Date('2026-10-16T09:00:00Z'), new Date('2026-10-16T09:00:00Z'));
    utimesSync(join(sessions, C, 'events.jsonl'), new Date('2026-10-16T10:00:00Z'), new Date('2026-10-16T10:00:00Z'));

    const list = listConversations(root, 'alpha');
    assert.deepEqual(list.map((c) => [c.id, c.messages, c.updatedAt]), [
      [C, 1, '2026-10-16T10:00:00.000Z'],
      [A, 2, '2026-10-16T09:00:00.000Z'],
    ]);
    assert.equal(list[0].title, `${'x'.repeat(80)}...`);
    assert.equal(list[1].title, 'How does the export work?');
    assert.deepEqual(listConversations(root, 'alpha', 1).map((c) => c.id), [C]);
    assert.deepEqual(listConversations(root, WORKSPACE_SCOPE), []);
  });

  it('opens a conversation only in its own scope', () => {
    appendMessage(root, 'alpha', A, user('hello'));
    assert.deepEqual(openConversation(root, 'alpha', A), { id: A, messages: [user('hello')] });
    assert.equal(openConversation(root, 'beta', A), null);
    assert.equal(openConversation(root, 'alpha', B), null);
    assert.throws(() => openConversation(root, 'alpha', '../escape'), /invalid conversation id/);
  });

  it('accepts a project key or the workspace scope', () => {
    assert.equal(isScope('alpha'), true);
    assert.equal(isScope(WORKSPACE_SCOPE), true);
    assert.equal(isScope('_other'), false);
    assert.equal(isScope(''), false);
  });
});

describe('captureAssistant', () => {
  async function* parts(list: Array<Record<string, unknown> & { type: string }>) {
    for (const part of list) yield part;
  }

  it('passes the stream through and records the answer and its tool calls', async () => {
    const input = [
      { type: 'tool-call', toolName: 'read_file' },
      { type: 'tool-result', output: 'x'.repeat(3000) },
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'finish' },
    ];
    let stored: StoredMessage | undefined;
    const seen = [];
    for await (const part of captureAssistant(parts(input), (m) => { stored = m; })) seen.push(part);
    assert.deepEqual(seen, input);
    assert.equal(stored!.content, 'Hello');
    assert.equal(stored!.toolCalls![0].name, 'read_file');
    assert.equal(stored!.toolCalls![0].status, 'done');
    assert.match(stored!.toolCalls![0].result!, /\(truncated\)$/);
  });

  it('keeps what was shown when the browser stops the turn', async () => {
    let stored: StoredMessage | undefined;
    const stream = captureAssistant(parts([{ type: 'text-delta', text: 'partial' }, { type: 'text-delta', text: ' more' }]), (m) => { stored = m; });
    await stream.next();
    await stream.return(undefined);
    assert.equal(stored!.content, 'partial');
  });

  it('records nothing for a turn that produced nothing', async () => {
    let calls = 0;
    for await (const _part of captureAssistant(parts([{ type: 'finish' }]), () => { calls++; })) { /* drain */ }
    assert.equal(calls, 0);
  });
});
