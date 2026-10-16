import type { ActivityRecord } from './activity-files.js';
import { clockState, type OpenClock } from './clocks.js';
import type { FloorAgent } from './floor.js';

/** A reported pose older than this has said nothing new; the clock speaks again. */
export const FRESH_MS = 10 * 60 * 1000;

interface Input {
  clocks: OpenClock[];
  records: ActivityRecord[];
  nowMs: number;
  maxHours: number;
}

/**
 * Agents outside this host, from their open clocks and their activity records. A clock is
 * presence (working, idle, offline); a fresh record is what the agent is doing. A raised
 * hand stays up until the agent reports again or its session is past the cap - a human
 * who stepped away for an hour must still see it. Nothing here guesses a pose.
 */
export function externalAgents({ clocks, records, nowMs, maxHours }: Input): FloorAgent[] {
  const capMs = maxHours * 3600 * 1000;
  const matched = new Set<ActivityRecord>();
  const agents: FloorAgent[] = clocks.map((clock) => {
    const record = records.find((r) => r.project === clock.project && clock.file.endsWith(`-${r.session}.json`));
    const presence = clockState(clock, nowMs, maxHours);
    const base: FloorAgent = {
      id: `clock:${clock.id}`,
      tool: clock.tool,
      project: clock.project,
      state: presence,
      detail: clock.note,
      since: new Date(clock.startMs).toISOString(),
      source: 'clock',
    };
    if (!record) return base;
    matched.add(record);
    const age = nowMs - record.atMs;
    if (record.state === 'waiting' ? age <= capMs : age <= FRESH_MS) {
      return { ...base, state: record.state, detail: record.detail || clock.note, since: new Date(record.atMs).toISOString() };
    }
    return base;
  });

  for (const record of records) {
    if (matched.has(record)) continue;
    const age = nowMs - record.atMs;
    if (age > capMs) continue;
    const reported = record.state === 'waiting' || age <= FRESH_MS;
    agents.push({
      id: `activity:${record.session}`,
      tool: record.tool,
      project: record.project,
      state: reported ? record.state : 'idle',
      detail: reported ? record.detail : 'no recent activity',
      since: new Date(record.atMs).toISOString(),
      source: 'activity',
    });
  }
  return agents;
}
