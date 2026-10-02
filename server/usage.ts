import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locality } from './endpoints.js';

/**
 * One chat request, as `ws usage` reads usage records (tool, projectRoot, end, tokens),
 * plus the endpoint and model that served it. Never the prompt or the answer: the
 * record says where context went and how much, not what it was (ADR-0021).
 */
export interface UsageRecord {
  tool: 'agent-control';
  endpoint: string;
  model: string;
  locality: Locality;
  project?: string;
  /** Absolute project folder, so `ws usage --project` attributes the record. */
  projectRoot?: string;
  start: string;
  end: string;
  finishReason: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** `<workspace>/.local/agent/usage/<YYYY-MM>.jsonl`, by local month like `ws usage`. */
export function usagePath(workspaceRoot: string, at: Date = new Date()): string {
  const month = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
  return join(workspaceRoot, '.local', 'agent', 'usage', `${month}.jsonl`);
}

export function recordUsage(workspaceRoot: string, record: UsageRecord): void {
  const path = usagePath(workspaceRoot, new Date(record.end));
  mkdirSync(join(workspaceRoot, '.local', 'agent', 'usage'), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + '\n', { encoding: 'utf-8', mode: 0o600 });
}
