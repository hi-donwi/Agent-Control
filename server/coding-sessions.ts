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

function sessionFile(root: string, project: string): string {
  if (!KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  return join(root, '.local', 'agent', 'coding-sessions', `${project}.json`);
}

/** The project's active coding session, or null when there is none or its record does not parse. */
export function readCodingSession(root: string, project: string): CodingSession | null {
  const path = sessionFile(root, project);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CodingSession;
  } catch {
    return null;
  }
}

export function writeCodingSession(root: string, project: string, session: CodingSession | null): void {
  const path = sessionFile(root, project);
  if (session === null) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(join(root, '.local', 'agent', 'coding-sessions'), { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/** `ws agent start` prints `cd <path>` as its one machine-readable line, around coloured, human-facing ones. */
function parseWorktreePath(output: string): string | null {
  const line = output.replace(ANSI_RE, '').split('\n').find((l) => l.startsWith('cd '));
  return line ? line.slice('cd '.length).trim() : null;
}

export interface StartSessionOptions {
  brief?: string;
  cardKey?: string;
}

/** Starts (or, idempotently, returns) the project's coding session. */
export async function startCodingSession(
  root: string,
  project: string,
  runner: SessionRunner,
  opts?: StartSessionOptions,
): Promise<CodingSession> {
  const existing = readCodingSession(root, project);
  if (existing) {
    if (opts && (opts.brief || opts.cardKey)) {
      const updated: CodingSession = {
        ...existing,
        ...(opts.brief ? { brief: opts.brief } : {}),
        ...(opts.cardKey ? { cardKey: opts.cardKey } : {}),
      };
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
 * Stops the project's coding session, if any. The clock and session lock close; the
 * worktree itself is kept for review, exactly as `ws agent stop` leaves it.
 */
export async function stopCodingSession(root: string, project: string, runner: SessionRunner): Promise<boolean> {
  const session = readCodingSession(root, project);
  if (!session) return false;
  await runner.runWs(['agent', 'stop', 'agent-control session ended'], { WS_SESSION_ID: session.id, WS_AGENT: 'agent-control' });
  writeCodingSession(root, project, null);
  return true;
}
