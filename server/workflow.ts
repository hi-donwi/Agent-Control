import type { CodingSession } from './coding-sessions.js';
import type { HandBackDeps } from './hand-back.js';

/**
 * Workflow rules (Agent-Workspace ADR-0024): a task handed to an agent from the board
 * follows its coding session. The session carries the card it was started for
 * (`cardKey: task:<id>`); when its work is verified the task waits for review, when it ships
 * the task is shipped, and when it is discarded the task is ready for an agent again. Each
 * move is a `ws task status`, and a comment says why, so the task's activity tells the story.
 * A rule never fails the hand-back it follows: the push or the discard already happened.
 */
export type SessionEvent = 'verified' | 'shipped' | 'discarded';

const NEXT: Record<SessionEvent, string> = { verified: 'review', shipped: 'done', discarded: 'ready' };

/** The task a session was started for, from its card key; none for a run step or no card. */
export function linkedTask(session: Pick<CodingSession, 'cardKey'>): string {
  const key = session.cardKey ?? '';
  return /^task:task_[a-z0-9][a-z0-9_-]*$/.test(key) ? key.slice('task:'.length) : '';
}

/** Moves the linked task and comments on it; the new status, or what went wrong. */
export async function followTask(deps: HandBackDeps, session: CodingSession, event: SessionEvent, note: string): Promise<string | null> {
  const id = linkedTask(session);
  if (!id) return null;
  const env = { WS_SESSION_ID: session.id, WS_AGENT: 'agent-control' };
  const status = NEXT[event];
  const moved = await deps.ws(['task', 'status', session.project, id, status], env);
  if (moved.code !== 0) return `[WARN] ${id} stays where it was: ${moved.stderr.trim() || `ws exited with ${moved.code}`}`;
  await deps.ws(['task', 'comment', session.project, id, note], env);
  return status;
}
