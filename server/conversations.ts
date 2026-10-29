import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The host's own state (Agent-Workspace ADR-0019 §2): a replayable event log per agent
 * session - one per conversation - at `<workspace>/.local/agent/sessions/<id>/events.jsonl`.
 * The first line names the conversation's scope (a project key, or `_workspace` for a chat
 * bound to no project); every later line is one message.
 *
 * It holds conversation content, so it stays on this machine: `.local/` is never committed
 * or pushed, files are mode 0600, and usage records still hold no content (ADR-0021).
 * A conversation never changes scope: a message for another project is refused, so one
 * project's history cannot be read back into another's chat (ADR-0011).
 */
export const WORKSPACE_SCOPE = '_workspace';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
/** Tool results can be whole files; the history keeps what the transcript shows. */
const RESULT_MAX = 2000;

export interface StoredToolCall {
  id?: string;
  name: string;
  status: 'pending' | 'done' | 'error';
  result?: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: StoredToolCall[];
  at: string;
}

type Event = { type: 'start'; scope: string; at: string } | ({ type: 'message' } & StoredMessage);

export function isConversationId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function isScope(scope: unknown): scope is string {
  return scope === WORKSPACE_SCOPE || (typeof scope === 'string' && KEY_RE.test(scope));
}

function sessionsDir(root: string): string {
  return join(root, '.local', 'agent', 'sessions');
}

function eventsPath(root: string, id: string): string {
  if (!isConversationId(id)) throw new Error(`invalid conversation id '${id}'`);
  return join(sessionsDir(root), id, 'events.jsonl');
}

function firstLine(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString('utf-8').split('\n')[0];
  } finally {
    closeSync(fd);
  }
}

function scopeOf(path: string): string | null {
  try {
    const start = JSON.parse(firstLine(path)) as Event;
    return start.type === 'start' && isScope(start.scope) ? start.scope : null;
  } catch {
    return null;
  }
}

/** Appends one message, starting the log on the first one; refuses a different scope. */
export function appendMessage(root: string, scope: string, id: string, message: StoredMessage): void {
  if (!isScope(scope)) throw new Error(`invalid scope '${scope}'`);
  const path = eventsPath(root, id);
  const write = (event: Event) => appendFileSync(path, JSON.stringify(event) + '\n', { encoding: 'utf-8', mode: 0o600 });
  if (!existsSync(path)) {
    mkdirSync(join(sessionsDir(root), id), { recursive: true, mode: 0o700 });
    write({ type: 'start', scope, at: message.at });
  } else if (scopeOf(path) !== scope) {
    throw new Error('this conversation belongs to another scope');
  }
  write({ type: 'message', ...message });
}

export function readConversation(root: string, id: string): { scope: string; messages: StoredMessage[] } | null {
  const path = eventsPath(root, id);
  if (!existsSync(path)) return null;
  const events = readFileSync(path, 'utf-8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as Event];
    } catch {
      return [];
    }
  });
  const start = events[0];
  if (!start || start.type !== 'start') return null;
  const messages = events.flatMap((event) => (event.type === 'message'
    ? [{ role: event.role, content: event.content, ...(event.toolCalls ? { toolCalls: event.toolCalls } : {}), at: event.at }]
    : []));
  return { scope: start.scope, messages };
}

/** A scope's conversations, newest first by their last write. */
function scopeEntries(root: string, scope: string): Array<{ id: string; mtimeMs: number }> {
  if (!isScope(scope)) throw new Error(`invalid scope '${scope}'`);
  const dir = sessionsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isConversationId)
    .map((id) => ({ id, path: join(dir, id, 'events.jsonl') }))
    .filter(({ path }) => existsSync(path) && scopeOf(path) === scope)
    .map(({ id, path }) => ({ id, mtimeMs: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** The most recently written conversation of a scope, or null when it has none. */
export function latestConversation(root: string, scope: string): { id: string; messages: StoredMessage[] } | null {
  const [best] = scopeEntries(root, scope);
  return best ? openConversation(root, scope, best.id) : null;
}

/** One conversation, only when it belongs to `scope`: another scope's history is not there to read. */
export function openConversation(root: string, scope: string, id: string): { id: string; messages: StoredMessage[] } | null {
  const conversation = readConversation(root, id);
  return conversation && conversation.scope === scope ? { id, messages: conversation.messages } : null;
}

export interface ConversationSummary {
  id: string;
  /** The first question, whitespace collapsed, cut to `TITLE_MAX` characters. */
  title: string;
  messages: number;
  updatedAt: string;
}

const TITLE_MAX = 80;

/** A scope's conversations for the history list, newest first, at most `limit`. */
export function listConversations(root: string, scope: string, limit = 30): ConversationSummary[] {
  return scopeEntries(root, scope).slice(0, limit).flatMap(({ id, mtimeMs }) => {
    const conversation = readConversation(root, id);
    if (!conversation) return [];
    const first = conversation.messages.find((m) => m.role === 'user')?.content ?? '';
    const text = first.replace(/\s+/g, ' ').trim();
    return [{
      id,
      title: text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}...` : text,
      messages: conversation.messages.length,
      updatedAt: new Date(mtimeMs).toISOString(),
    }];
  });
}

interface StreamPart {
  type: string;
  toolCallId?: string;
  text?: string;
  toolName?: string;
  output?: unknown;
  error?: unknown;
}

function asText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n...(truncated)` : text;
}

/**
 * Passes `parts` through unchanged and hands the assistant's message to `onDone` when the
 * turn ends - finished, failed, or stopped by the browser (then what was shown so far).
 */
export async function* captureAssistant<T extends StreamPart>(
  parts: AsyncIterable<T>,
  onDone: (message: StoredMessage) => void,
): AsyncGenerator<T> {
  let content = '';
  const toolCalls: StoredToolCall[] = [];
  try {
    for await (const part of parts) {
      if (part.type === 'text-delta') content += part.text ?? '';
      if (part.type === 'tool-call') toolCalls.push({ id: part.toolCallId, name: part.toolName ?? 'tool', status: 'pending' });
      if (part.type === 'tool-result' || part.type === 'tool-error') {
        const call = [...toolCalls].reverse().find((c) => c.status === 'pending' && (!part.toolCallId || c.id === part.toolCallId));
        if (call) {
          call.status = part.type === 'tool-result' ? 'done' : 'error';
          call.result = asText(part.type === 'tool-result' ? part.output : part.error instanceof Error ? part.error.message : part.error);
        }
      }
      yield part;
    }
  } finally {
    if (content || toolCalls.length) {
      onDone({ role: 'assistant', content, ...(toolCalls.length ? { toolCalls } : {}), at: new Date().toISOString() });
    }
  }
}
