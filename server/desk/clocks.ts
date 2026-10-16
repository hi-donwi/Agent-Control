import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_RE, contextDir } from './workspace-files.js';

/**
 * An agent clock `ws agent in` opened and nothing has closed yet:
 * `<context>/works/.open-agent-<actor>-<tool>-<session>.json`. `ws` touches the file on
 * every call it makes, so its modification time is the agent's last sign of life.
 */
export interface OpenClock {
  id: string;
  project: string;
  tool: string;
  actor: string;
  start: string;
  startMs: number;
  note: string;
  heartbeatMs: number;
  /** The file name, which ends in `-<session>.json`: how an activity record finds its clock. */
  file: string;
}

const OPEN_AGENT_RE = /^\.open-agent-.+\.json$/;

/** A heartbeat this recent means the agent is working right now. */
export const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

export type ClockState = 'working' | 'idle' | 'offline';

export function parseOpenClock(text: string, heartbeatMs: number, file = ''): OpenClock | null {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const project = typeof record.project === 'string' ? record.project : '';
  const id = typeof record.id === 'string' ? record.id : '';
  if (record.kind !== 'agent' || !KEY_RE.test(project) || !id) return null;
  const startSeconds = typeof record.start_ts === 'number' ? record.start_ts : NaN;
  const start = typeof record.start === 'string' ? record.start : '';
  const startMs = Number.isFinite(startSeconds) ? startSeconds * 1000 : Date.parse(start);
  if (!Number.isFinite(startMs)) return null;
  return {
    id,
    project,
    tool: typeof record.tool === 'string' && record.tool ? record.tool : 'agent',
    actor: typeof record.actor === 'string' ? record.actor : '',
    start,
    startMs,
    note: typeof record.note === 'string' ? record.note : '',
    heartbeatMs,
    file,
  };
}

export function readOpenClocks(root: string): OpenClock[] {
  const works = join(contextDir(root), 'works');
  if (!existsSync(works)) return [];
  return readdirSync(works)
    .filter((name) => OPEN_AGENT_RE.test(name))
    .flatMap((name) => {
      const path = join(works, name);
      try {
        const clock = parseOpenClock(readFileSync(path, 'utf-8'), statSync(path).mtimeMs, name);
        return clock ? [clock] : [];
      } catch {
        return [];
      }
    });
}

/**
 * What an open clock can honestly say: working (a recent heartbeat), idle (present but
 * quiet), or offline (open past the session cap - abandoned, `ws agent recover` closes it).
 */
export function clockState(clock: OpenClock, nowMs: number, maxHours: number): ClockState {
  if (nowMs - clock.startMs > maxHours * 3600 * 1000) return 'offline';
  return nowMs - clock.heartbeatMs <= ACTIVE_WINDOW_MS ? 'working' : 'idle';
}
