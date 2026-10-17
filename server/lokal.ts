import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Endpoint } from './endpoints.js';
import { isConversationId, readConversation } from './conversations.js';

export const LOKAL_DEFAULT_PORT = 52140;
export const LOKAL_BASE_URL = `http://127.0.0.1:${LOKAL_DEFAULT_PORT}/v1`;

/**
 * Auto-detects the Agent-Local (lokal) endpoint on loopback when ~/.lokal/serve.token exists.
 * Follows Agent-Workspace ADR-0021 (loopback locality) and lokal design.
 */
export function detectLokalEndpoint(home = homedir()): Endpoint | null {
  const tokenPath = join(home, '.lokal', 'serve.token');
  if (!existsSync(tokenPath)) return null;

  return {
    name: 'lokal',
    protocol: 'openai-chat',
    baseUrl: LOKAL_BASE_URL,
    credential: 'file:~/.lokal/serve.token',
    locality: 'local',
    models: ['lokal/auto', 'lokal/qwen', 'lokal/llama'],
  };
}

export interface ExportTraceResult {
  traceId: string;
  path: string;
  eventsCount: number;
}

/**
 * Exports a conversation session's replayable events log from
 * `<workspace>/.local/agent/sessions/<id>/events.jsonl` to `~/.lokal/traces/<id>.json`
 * per lokal ADR-0008. Files are created mode 0600 in a mode 0700 directory.
 */
export function exportSessionTrace(
  root: string,
  conversationId: string,
  home = homedir(),
): ExportTraceResult {
  if (!isConversationId(conversationId)) {
    throw new Error(`Invalid conversation id: ${conversationId}`);
  }

  const conv = readConversation(root, conversationId);
  if (!conv) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const eventsFile = join(root, '.local', 'agent', 'sessions', conversationId, 'events.jsonl');
  if (!existsSync(eventsFile)) {
    throw new Error(`Conversation events file not found: ${eventsFile}`);
  }

  const rawLines = readFileSync(eventsFile, 'utf-8').split('\n').filter(Boolean);
  const events: unknown[] = [];
  for (const line of rawLines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip corrupted lines
    }
  }

  const tracesDir = join(home, '.lokal', 'traces');
  if (!existsSync(tracesDir)) {
    mkdirSync(tracesDir, { recursive: true, mode: 0o700 });
  }

  const targetPath = join(tracesDir, `${conversationId}.json`);
  const tracePayload = {
    version: '1.0',
    id: conversationId,
    scope: conv.scope,
    exportedAt: new Date().toISOString(),
    events,
    summary: {
      messagesCount: conv.messages.length,
      toolCallsCount: conv.messages.reduce((acc, m) => acc + (m.toolCalls?.length ?? 0), 0),
    },
  };

  writeFileSync(targetPath, JSON.stringify(tracePayload, null, 2), { encoding: 'utf-8', mode: 0o600 });

  return {
    traceId: conversationId,
    path: targetPath,
    eventsCount: events.length,
  };
}
