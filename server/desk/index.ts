import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listPending } from '../approvals.js';
import { readCodingSession } from '../coding-sessions.js';
import type { ActivityRegistry } from './activity.js';
import { readActivityRecords } from './activity-files.js';
import { externalAgents } from './agents.js';
import { readOpenClocks } from './clocks.js';
import { buildFloor, type Floor, type PendingSummary } from './floor.js';
import { readRegistry } from './registry.js';
import { KEY_RE, contextDir, inside, maxAgentSessionHours } from './workspace-files.js';

export { ActivityRegistry } from './activity.js';
export { COLLECTIONS, PROJECT_COLLECTIONS, isCollection, queryRows, readCollection } from './collections.js';
export type { Floor } from './floor.js';
export { floorEvents } from './stream.js';

/** Finds the latest recorded activity timestamp for a project from context memory, runs, or works. */
export function readProjectLastActive(root: string, project: string): string | null {
  if (!KEY_RE.test(project)) return null;
  let latestMs = 0;
  const ctx = contextDir(root);

  try {
    const activePath = inside(ctx, 'memory', 'projects', project, 'active.md');
    if (existsSync(activePath)) {
      const stat = statSync(activePath);
      if (stat.mtimeMs > latestMs) latestMs = stat.mtimeMs;
    }
  } catch {
    // missing or escaping path is not activity
  }

  try {
    const runsDir = inside(ctx, 'runs', project);
    if (existsSync(runsDir)) {
      const runs = readdirSync(runsDir);
      for (const run of runs) {
        const match = run.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
        if (match) {
          const runDate = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`).getTime();
          if (runDate > latestMs) latestMs = runDate;
        }
      }
    }
  } catch {
    // missing or unreadable runs directory is skipped
  }

  for (const sub of ['agent', 'human']) {
    try {
      const p = inside(ctx, 'works', sub, project);
      if (existsSync(p)) {
        const files = readdirSync(p);
        for (const f of files) {
          const stat = statSync(join(p, f));
          if (stat.mtimeMs > latestMs) latestMs = stat.mtimeMs;
        }
      }
    } catch {
      // missing works directory is skipped
    }
  }

  return latestMs > 0 ? new Date(latestMs).toISOString() : null;
}

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
  const external = externalAgents({
    clocks: readOpenClocks(root),
    records: readActivityRecords(root),
    nowMs: now.getTime(),
    maxHours,
  });
  const codingSessions = new Set(registry.map((row) => row.key).filter((key) => readCodingSession(root, key) !== null));
  const lastActive: Record<string, string | null> = {};
  for (const row of registry) {
    lastActive[row.key] = readProjectLastActive(root, row.key);
  }
  for (const agent of external) {
    if (!(agent.project in lastActive)) {
      lastActive[agent.project] = readProjectLastActive(root, agent.project);
    }
  }
  for (const act of activity.list()) {
    if (!(act.project in lastActive)) {
      lastActive[act.project] = readProjectLastActive(root, act.project);
    }
  }
  return buildFloor({ registry, external, host: activity.list(), approvals: approvalSummaries(root), codingSessions, lastActive }, now);
}
