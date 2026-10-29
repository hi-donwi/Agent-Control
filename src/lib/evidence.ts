import type { EvidenceMetadata, EvidenceReference, ToolCallResult } from './types';

const TASK_ID_RE = /^task_[a-z0-9][a-z0-9_-]*$/;
const SCOPE_RE = /^@?[a-z0-9][a-z0-9_-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_TOOLS = new Set(['list_tasks', 'today', 'add_task', 'update_task']);

export function findPendingToolCall(calls: ToolCallResult[], toolCallId?: string): ToolCallResult | undefined {
  return [...calls].reverse().find((call) => call.status === 'pending'
    && (toolCallId === undefined || call.id === toolCallId));
}

/** Derive displayable evidence without treating arbitrary tool output as a record reference. */
export function buildEvidenceMetadata(toolCalls: ToolCallResult[] | undefined): EvidenceMetadata[] {
  return (toolCalls ?? []).flatMap((call) => {
    if (!call.id) return [];
    return [{
      id: call.id,
      tool: call.name,
      status: call.status,
      references: referencesFor(call),
    }];
  });
}

function referencesFor(call: ToolCallResult): EvidenceReference[] {
  const parsed = parseResult(call.result);
  if (!parsed || typeof parsed !== 'object') return [];
  const record = parsed as Record<string, unknown>;
  const references: EvidenceReference[] = [];
  const argumentScope = typeof call.args.scope === 'string' && SCOPE_RE.test(call.args.scope)
    ? call.args.scope
    : undefined;

  if (TASK_TOOLS.has(call.name)) {
    const candidates = [record, ...(Array.isArray(record.tasks) ? record.tasks : []), ...(Array.isArray(record.in_progress) ? record.in_progress : [])];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const item = candidate as Record<string, unknown>;
      if (typeof item.id !== 'string' || !TASK_ID_RE.test(item.id)) continue;
      const scope = typeof item.scope === 'string' && SCOPE_RE.test(item.scope) ? item.scope : argumentScope;
      if (!references.some((reference) => reference.kind === 'task' && reference.id === item.id)) {
        references.push({ kind: 'task', id: item.id, ...(scope ? { scope } : {}) });
      }
    }
  }

  if (record.approvalRequired === true && typeof record.requestId === 'string' && UUID_RE.test(record.requestId)) {
    references.push({ kind: 'approval', id: record.requestId });
  }

  if (call.name === 'git_diff' && call.id && typeof record.content === 'string' && record.content.startsWith('diff --git ')) {
    references.push({ kind: 'diff', id: call.id });
  }

  return references;
}

function parseResult(result: string | undefined): unknown {
  if (!result || result.endsWith('\n...(truncated)')) return null;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return null;
  }
}
