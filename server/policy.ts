import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Risk-based agent autonomy (Agent-Workspace ADR-0014): what a tool call may do before
 * a human decides, read from the operator-owned policy outside every repository. This
 * mirrors `ws policy check` exactly, so the same policy file governs the CLI and the
 * agent host identically.
 */
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
const ACTION_RE = /^[a-z0-9][a-z0-9._:-]*$/;
const LEVELS = ['read', 'change', 'approval-required'] as const;
export type Level = typeof LEVELS[number];

function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export interface OperatorPolicy {
  schema_version: 1;
  default: Level;
  actions: Record<string, Level>;
  /** ADR-0021: which LLM endpoints this project's context may reach. Read by egress.ts. */
  llm?: { endpoints?: unknown };
}

export function policyPath(workspaceRoot: string, project: string): string {
  if (!KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  return join(workspaceRoot, '.local', 'agent', 'policies', `${project}.json`);
}

/**
 * The project's operator policy, or null when it is missing or does not validate.
 * Never throws on bad file content - an invalid policy fails closed, the same as a
 * missing one, rather than reporting why in a way a caller might act on.
 */
export function loadPolicy(workspaceRoot: string, project: string): OperatorPolicy | null {
  const path = policyPath(workspaceRoot, project);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const policy = raw as Record<string, unknown>;
  if (policy.schema_version !== 1) return null;
  const def = policy.default ?? 'approval-required';
  const actions = policy.actions ?? {};
  if (!isLevel(def)) return null;
  if (typeof actions !== 'object' || actions === null || Array.isArray(actions)) return null;
  if (!Object.values(actions).every(isLevel)) return null;
  return { schema_version: 1, default: def, actions: actions as Record<string, Level>, llm: policy.llm as OperatorPolicy['llm'] };
}

/**
 * A hash of the policy file's raw bytes, whether or not it validates - a sentinel when
 * it is missing. An approval is bound to this (ADR-0020 §2): if the policy changes
 * between the request and execution, the hash changes and the approval is voided,
 * whether the edit made the action stricter or looser.
 */
export function policyHash(workspaceRoot: string, project: string): string {
  const path = policyPath(workspaceRoot, project);
  const bytes = existsSync(path) ? readFileSync(path) : Buffer.from('(no policy file)');
  return createHash('sha256').update(bytes).digest('hex');
}

export type PolicyDecision =
  | { decision: 'allow'; level: Level }
  | { decision: 'approval-required'; level: 'approval-required' }
  | { decision: 'incomplete'; reason: string };

/**
 * Classifies one action label against the project's policy. `read` and `change` are
 * `allow`; `approval-required` means a human decision is needed before the tool runs
 * (ADR-0020). A missing policy, an invalid one, or a malformed action label is
 * `incomplete` - never treated as allow.
 */
export function classifyAction(workspaceRoot: string, project: string, action: string): PolicyDecision {
  if (!ACTION_RE.test(action)) return { decision: 'incomplete', reason: `invalid action: ${action}` };
  const policy = loadPolicy(workspaceRoot, project);
  if (!policy) return { decision: 'incomplete', reason: 'no operator policy, or it is invalid' };
  const level = policy.actions[action] ?? policy.default;
  if (level === 'approval-required') return { decision: 'approval-required', level };
  return { decision: 'allow', level };
}
