import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Local approval record for actions that stay on this machine (Agent-Workspace
 * ADR-0020). An action `ws policy check`-style classification marks
 * `approval-required` is not executed on a model's say-so: a request is recorded,
 * an operator decides once, and the executor re-verifies every bound field
 * immediately before running - never trusting its own earlier read.
 *
 * Binding fields (ADR-0020 §2): the project, a revision (the project repository's
 * HEAD, read by the caller), the action label, a hash of the exact tool input, and a
 * hash of the policy that classified it. Any one changing since the request voids it.
 */
export interface ApprovalContext {
  project: string;
  headSha: string;
  action: string;
  inputHash: string;
  policyHash: string;
}

export interface ApprovalRequest extends ApprovalContext {
  id: string;
  requestedAt: string;
  expiresAt: string;
}

type Event =
  | ({ type: 'requested' } & ApprovalRequest)
  | { type: 'approved' | 'denied'; id: string; project: string; decidedAt: string }
  | { type: 'consumed'; id: string; project: string; consumedAt: string };

function approvalsDir(root: string, project: string): string {
  if (!KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  return join(root, '.local', 'agent', 'approvals', project);
}

function monthFile(root: string, project: string, isoDate: string): string {
  return join(approvalsDir(root, project), `${isoDate.slice(0, 7)}.jsonl`);
}

function append(root: string, project: string, isoDate: string, event: Event): void {
  const dir = approvalsDir(root, project);
  mkdirSync(dir, { recursive: true });
  appendFileSync(monthFile(root, project, isoDate), JSON.stringify(event) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/** Every event ever recorded for this project, oldest first, across every month file. */
function readEvents(root: string, project: string): Event[] {
  const dir = approvalsDir(root, project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) =>
    readFileSync(join(dir, f), 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Event));
}

type RequestState = { request: ApprovalRequest; status: 'pending' | 'approved' | 'denied' | 'consumed'; expired: boolean };

function stateOf(events: Event[], id: string, now: number): RequestState | null {
  const requested = events.find((e): e is Event & { type: 'requested' } => e.type === 'requested' && e.id === id);
  if (!requested) return null;
  const { type: _type, ...request } = requested;
  let status: RequestState['status'] = 'pending';
  for (const e of events) {
    if (e.id !== id) continue;
    if (e.type === 'approved') status = 'approved';
    if (e.type === 'denied') status = 'denied';
    if (e.type === 'consumed') status = 'consumed';
  }
  return { request, status, expired: now > new Date(request.expiresAt).getTime() };
}

/** Records a new request. The default expiry is 15 minutes (ADR-0020 §3); `ttlMs` overrides it (tests use a negative value to produce an already-expired request). */
export function requestApproval(root: string, context: ApprovalContext, ttlMs: number = DEFAULT_TTL_MS): ApprovalRequest {
  const requestedAt = new Date().toISOString();
  const request: ApprovalRequest = {
    ...context,
    id: randomUUID(),
    requestedAt,
    expiresAt: new Date(Date.parse(requestedAt) + ttlMs).toISOString(),
  };
  append(root, context.project, requestedAt, { type: 'requested', ...request });
  return request;
}

/** Pending, unexpired requests for a project - what an approval inbox shows. */
export function listPending(root: string, project: string): ApprovalRequest[] {
  const events = readEvents(root, project);
  const ids = [...new Set(events.filter((e) => e.type === 'requested').map((e) => e.id))];
  const now = Date.now();
  return ids
    .map((id) => stateOf(events, id, now))
    .filter((s): s is RequestState => s !== null && s.status === 'pending' && !s.expired)
    .map((s) => s.request);
}

/** Records the operator's decision. Returns false, and records nothing, for a request that is unknown, already decided, consumed, or expired - decide once. */
export function decide(root: string, project: string, id: string, decision: 'approved' | 'denied'): boolean {
  const state = stateOf(readEvents(root, project), id, Date.now());
  if (!state || state.status !== 'pending' || state.expired) return false;
  append(root, project, new Date().toISOString(), { type: decision, id, project, decidedAt: new Date().toISOString() });
  return true;
}

/**
 * The independent re-check immediately before execution (ADR-0020 §4): approved, not
 * expired, not already used, and every bound field matches the request exactly - a
 * mismatch means the worktree or the policy moved since the human decided, so the
 * approval no longer covers what is about to run.
 */
export function verifyAndConsume(
  root: string,
  id: string,
  context: ApprovalContext,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const events = readEvents(root, context.project);
  const state = stateOf(events, id, now);
  if (!state) return { ok: false, reason: 'unknown request' };
  if (state.status === 'consumed') return { ok: false, reason: 'already consumed' };
  if (state.status !== 'approved') return { ok: false, reason: 'not approved' };
  if (now > new Date(state.request.expiresAt).getTime()) return { ok: false, reason: 'expired' };
  const { id: _id, requestedAt: _r, expiresAt: _e, ...bound } = state.request;
  // Field-by-field, not JSON.stringify: object key order must never decide whether an
  // approval still covers what is about to run.
  const unchanged = (['project', 'headSha', 'action', 'inputHash', 'policyHash'] as const)
    .every((key) => bound[key] === context[key]);
  if (!unchanged) return { ok: false, reason: 'context changed since the request' };
  append(root, context.project, new Date(now).toISOString(), { type: 'consumed', id, project: context.project, consumedAt: new Date(now).toISOString() });
  return { ok: true };
}
