import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_RE } from './workspace-files.js';

/**
 * What an agent session outside this host says it is doing, as Agent-Workspace writes it:
 * `<root>/.local/agent/activity/<session>.json`, one record per session, replaced on every
 * change (`ws agent activity`, or the Claude Code hooks `ws hooks install` adds). Names
 * only - a tool name at most, never input, prompts, or output.
 */
export type ReportedState =
  | 'idle' | 'working' | 'thinking' | 'reading' | 'typing'
  | 'running' | 'learning' | 'waiting' | 'warning';

export interface ActivityRecord {
  session: string;
  project: string;
  tool: string;
  state: ReportedState;
  detail: string;
  atMs: number;
}

const STATES: ReadonlySet<string> = new Set([
  'idle', 'working', 'thinking', 'reading', 'typing', 'running', 'learning', 'waiting', 'warning',
]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DETAIL_MAX = 120;

export function parseActivityRecord(text: string): ActivityRecord | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return null;
  const session = typeof raw.session === 'string' ? raw.session : '';
  const project = typeof raw.project === 'string' ? raw.project : '';
  const tool = typeof raw.tool === 'string' ? raw.tool : '';
  const state = typeof raw.state === 'string' ? raw.state : '';
  const detail = typeof raw.detail === 'string' ? raw.detail : '';
  const atMs = typeof raw.at === 'string' ? Date.parse(raw.at) : NaN;
  if (!SLUG_RE.test(session) || !KEY_RE.test(project) || !SLUG_RE.test(tool) || !STATES.has(state) || !Number.isFinite(atMs)) {
    return null;
  }
  return { session, project, tool, state: state as ReportedState, detail: detail.slice(0, DETAIL_MAX), atMs };
}

export function readActivityRecords(root: string): ActivityRecord[] {
  const dir = join(root, '.local', 'agent', 'activity');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .flatMap((name) => {
      try {
        const record = parseActivityRecord(readFileSync(join(dir, name), 'utf-8'));
        // The file name is the session; a record claiming another session is ignored.
        return record && `${record.session}.json` === name ? [record] : [];
      } catch {
        return [];
      }
    });
}
