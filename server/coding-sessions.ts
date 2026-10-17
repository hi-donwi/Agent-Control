import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

/**
 * A chat's coding session: a `ws agent start` worktree its mutating tools operate in
 * instead of the primary checkout (Agent-Workspace ADR-0019). One per project at a
 * time - starting again while one is active returns it unchanged.
 */
export interface CodingSession {
  id: string;
  project: string;
  worktree: string;
  branch: string;
  startedAt: string;
  brief?: string;
  cardKey?: string;
  /** The latest `ws verify` of the worktree (server/hand-back.ts). */
  verify?: VerifyState;
  /** The latest push of the session's work to the project's main branch. */
  shipped?: { head: string; base: string; commits: number; at: string };
}

export interface VerifyState {
  /** `stale`: the worktree changed while the contract ran, so the result says nothing about it now. */
  state: 'running' | 'pass' | 'findings' | 'incomplete' | 'stale' | 'error';
  /** The worktree's content when verify started, as a git tree id. */
  tree: string;
  startedAt: string;
  finishedAt?: string;
  commands?: Array<{ id: string; status: string; required?: boolean; duration_ms?: number }>;
  error?: string;
}

export interface SessionRunner {
  /** Runs `ws <args>`, with `env` merged over the ambient environment; returns stdout. */
  runWs(args: string[], env: Record<string, string>): Promise<string>;
  /** The current branch of a worktree. */
  currentBranch(worktree: string): Promise<string>;
}

interface StoredSessions {
  activeId?: string;
  sessions: CodingSession[];
}

function sessionFile(root: string, project: string): string {
  if (!KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  return join(root, '.local', 'agent', 'coding-sessions', `${project}.json`);
}

function parseStoredSessions(content: string): CodingSession[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as CodingSession[];
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray((parsed as StoredSessions).sessions)) {
        return (parsed as StoredSessions).sessions;
      }
      if (typeof (parsed as CodingSession).id === 'string') {
        return [parsed as CodingSession];
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** Lists all active coding sessions for the project. */
export function listCodingSessions(root: string, project: string): CodingSession[] {
  const path = sessionFile(root, project);
  if (!existsSync(path)) return [];
  try {
    return parseStoredSessions(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

/** The project's active coding session (or session by id), or null when none exists. */
export function readCodingSession(root: string, project: string, sessionId?: string): CodingSession | null {
  const list = listCodingSessions(root, project);
  if (list.length === 0) return null;
  if (sessionId) {
    return list.find((s) => s.id === sessionId) ?? null;
  }
  return list[list.length - 1] ?? null;
}

export function writeCodingSession(root: string, project: string, session: CodingSession | null, sessionId?: string): void {
  const path = sessionFile(root, project);
  const current = listCodingSessions(root, project);
  let updated: CodingSession[];
  if (session === null) {
    if (sessionId) {
      updated = current.filter((s) => s.id !== sessionId);
    } else {
      updated = [];
    }
  } else {
    const existingIdx = current.findIndex((s) => s.id === session.id);
    if (existingIdx >= 0) {
      updated = [...current];
      updated[existingIdx] = session;
    } else {
      updated = [...current, session];
    }
  }
  if (updated.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(join(root, '.local', 'agent', 'coding-sessions'), { recursive: true });
  const payload: StoredSessions = {
    activeId: updated[updated.length - 1].id,
    sessions: updated,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/** `ws agent start` prints `cd <path>` as its one machine-readable line, around coloured, human-facing ones. */
function parseWorktreePath(output: string): string | null {
  const line = output.replace(ANSI_RE, '').split('\n').find((l) => l.startsWith('cd '));
  return line ? line.slice('cd '.length).trim() : null;
}

export interface StartSessionOptions {
  brief?: string;
  cardKey?: string;
  allowParallel?: boolean;
}

/** Starts a coding session for a project. Supports parallel sessions per project. */
export async function startCodingSession(
  root: string,
  project: string,
  runner: SessionRunner,
  opts?: StartSessionOptions,
): Promise<CodingSession> {
  const existingList = listCodingSessions(root, project);

  // If a session already exists for this cardKey, update brief and return it
  if (opts?.cardKey) {
    const forCard = existingList.find((s) => s.cardKey === opts.cardKey);
    if (forCard) {
      if (opts.brief && forCard.brief !== opts.brief) {
        const updated: CodingSession = { ...forCard, brief: opts.brief };
        writeCodingSession(root, project, updated);
        return updated;
      }
      return forCard;
    }
  }

  // Without cardKey and without explicit parallel permission, return latest session for idempotency
  if (!opts?.cardKey && !opts?.allowParallel && existingList.length > 0) {
    const existing = existingList[existingList.length - 1];
    if (opts?.brief) {
      const updated: CodingSession = { ...existing, brief: opts.brief };
      writeCodingSession(root, project, updated);
      return updated;
    }
    return existing;
  }

  const id = randomUUID();
  const reason = opts?.brief ? `agent-control: ${opts.brief}` : `agent-control coding session ${id}`;
  const output = await runner.runWs(
    ['agent', 'start', project, reason],
    { WS_SESSION_ID: id, WS_AGENT: 'agent-control' },
  );
  const worktree = parseWorktreePath(output);
  if (!worktree) throw new Error('ws agent start did not report a worktree path');
  const branch = await runner.currentBranch(worktree);
  const session: CodingSession = {
    id,
    project,
    worktree,
    branch,
    startedAt: new Date().toISOString(),
    ...(opts?.brief ? { brief: opts.brief } : {}),
    ...(opts?.cardKey ? { cardKey: opts.cardKey } : {}),
  };
  writeCodingSession(root, project, session);
  return session;
}

/**
 * Stops a project's coding session. If sessionId is given, stops that specific session;
 * otherwise stops the latest active session.
 */
export async function stopCodingSession(root: string, project: string, runner: SessionRunner, sessionId?: string): Promise<boolean> {
  const session = readCodingSession(root, project, sessionId);
  if (!session) return false;
  await runner.runWs(['agent', 'stop', 'agent-control session ended'], { WS_SESSION_ID: session.id, WS_AGENT: 'agent-control' });
  writeCodingSession(root, project, null, session.id);
  return true;
}
