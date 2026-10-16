import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listPending } from '../approvals.js';
import { readCodingSession } from '../coding-sessions.js';
import type { ActivityRegistry } from './activity.js';
import { clockState, readOpenClocks } from './clocks.js';
import { buildFloor, type Floor, type PendingSummary } from './floor.js';
import { readRegistry } from './registry.js';
import { KEY_RE, maxAgentSessionHours } from './workspace-files.js';

export { ActivityRegistry } from './activity.js';
export { COLLECTIONS, PROJECT_COLLECTIONS, isCollection, queryRows, readCollection } from './collections.js';
export type { Floor } from './floor.js';

/** Projects with an approvals directory: the only ones that can have a raised hand. */
function approvalSummaries(root: string): Record<string, PendingSummary> {
  const dir = join(root, '.local', 'agent', 'approvals');
  if (!existsSync(dir)) return {};
  const summaries: Record<string, PendingSummary> = {};
  for (const project of readdirSync(dir).filter((name) => KEY_RE.test(name))) {
    try {
      const pending = listPending(root, project).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      if (pending.length) summaries[project] = { count: pending.length, action: pending[0].action, requestedAt: pending[0].requestedAt };
    } catch {
      // an unreadable record is not a raised hand
    }
  }
  return summaries;
}

/** The floor as the workspace and this host know it right now. Read-only. */
export function deskFloor(root: string, activity: ActivityRegistry, now = new Date()): Floor {
  const registry = readRegistry(root);
  const maxHours = maxAgentSessionHours(root);
  const clocks = readOpenClocks(root).map((clock) => ({ clock, state: clockState(clock, now.getTime(), maxHours) }));
  const codingSessions = new Set(registry.map((row) => row.key).filter((key) => readCodingSession(root, key) !== null));
  return buildFloor({ registry, clocks, host: activity.list(), approvals: approvalSummaries(root), codingSessions }, now);
}
