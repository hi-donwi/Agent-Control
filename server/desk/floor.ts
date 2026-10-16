import type { HostActivity } from './activity.js';
import type { RegistryRow } from './registry.js';

/**
 * The floor: clients as zones, projects as rooms, agents at their desks. Built by a pure
 * function from what the workspace records, so every pose can be traced to a source.
 * See docs/desk/README.md for the state table.
 */
export type ActivityState =
  | 'idle' | 'working' | 'thinking' | 'reading' | 'typing'
  | 'running' | 'learning' | 'waiting' | 'warning' | 'offline';

export interface FloorAgent {
  id: string;
  /** The agent tool: `agent-control` for this host, else the clock's tool (claude-code, opencode, ...). */
  tool: string;
  project: string;
  state: ActivityState;
  detail: string;
  since: string;
  /** host: this server's own chat; clock and activity: an agent outside it (server/desk/agents.ts). */
  source: 'host' | 'clock' | 'activity';
}

export interface FloorRoom {
  key: string;
  group: string;
  description: string;
  agents: FloorAgent[];
  pendingApprovals: number;
  codingSession: boolean;
}

export interface FloorZone {
  client: string;
  rooms: FloorRoom[];
}

export interface Floor {
  generatedAt: string;
  zones: FloorZone[];
  totals: { projects: number; agents: number; active: number; waiting: number };
}

export interface PendingSummary {
  count: number;
  /** The oldest pending request's action, shown on the raised hand. */
  action: string;
  requestedAt: string;
}

export interface FloorInput {
  registry: RegistryRow[];
  /** Agents outside this host, already merged from clocks and activity records. */
  external: FloorAgent[];
  host: HostActivity[];
  approvals: Record<string, PendingSummary>;
  codingSessions: ReadonlySet<string>;
}

/** Clocks can name a project the registry does not list (the framework's own key). */
const UNREGISTERED = '-';
const QUIET: ReadonlySet<ActivityState> = new Set(['idle', 'offline']);

export function buildFloor(input: FloorInput, now: Date): Floor {
  const rooms = new Map<string, FloorRoom & { client: string }>();
  const room = (key: string, client = UNREGISTERED) => {
    let entry = rooms.get(key);
    if (!entry) {
      entry = { key, client, group: '-', description: '', agents: [], pendingApprovals: 0, codingSession: false };
      rooms.set(key, entry);
    }
    return entry;
  };

  for (const row of input.registry) {
    Object.assign(room(row.key, row.client), { group: row.group, description: row.description });
  }

  for (const agent of input.external) {
    room(agent.project).agents.push({ ...agent });
  }

  const hostAgents = new Map<string, FloorAgent>();
  for (const activity of input.host) {
    const agent: FloorAgent = {
      id: `host:${activity.project}`,
      tool: 'agent-control',
      project: activity.project,
      state: activity.state,
      detail: activity.detail,
      since: activity.since,
      source: 'host',
    };
    hostAgents.set(activity.project, agent);
    room(activity.project).agents.push(agent);
  }

  // Only this host asks for approvals, so its agent is the one that raises a hand - even
  // when it has not chatted since the server started.
  for (const [project, pending] of Object.entries(input.approvals)) {
    if (pending.count === 0) continue;
    const target = room(project);
    target.pendingApprovals = pending.count;
    let agent = hostAgents.get(project);
    if (!agent) {
      agent = { id: `host:${project}`, tool: 'agent-control', project, state: 'idle', detail: '', since: pending.requestedAt, source: 'host' };
      hostAgents.set(project, agent);
      target.agents.push(agent);
    }
    Object.assign(agent, { state: 'waiting', detail: `approval: ${pending.action}`, since: pending.requestedAt });
  }

  for (const project of input.codingSessions) {
    if (rooms.has(project)) room(project).codingSession = true;
  }

  const busy = (r: FloorRoom) => r.agents.filter((a) => !QUIET.has(a.state)).length;
  const zones = new Map<string, FloorZone>();
  for (const { client, ...rest } of rooms.values()) {
    rest.agents.sort((a, b) => a.since.localeCompare(b.since));
    if (!zones.has(client)) zones.set(client, { client, rooms: [] });
    zones.get(client)!.rooms.push(rest);
  }
  const ordered = [...zones.values()];
  for (const zone of ordered) {
    zone.rooms.sort((a, b) => busy(b) - busy(a) || b.agents.length - a.agents.length || a.key.localeCompare(b.key));
  }
  const zoneAgents = (z: FloorZone) => z.rooms.reduce((n, r) => n + r.agents.length, 0);
  ordered.sort((a, b) =>
    (a.client === UNREGISTERED ? 1 : 0) - (b.client === UNREGISTERED ? 1 : 0)
    || zoneAgents(b) - zoneAgents(a)
    || a.client.localeCompare(b.client));

  const agents = ordered.flatMap((z) => z.rooms.flatMap((r) => r.agents));
  return {
    generatedAt: now.toISOString(),
    zones: ordered,
    totals: {
      projects: rooms.size,
      agents: agents.length,
      active: agents.filter((a) => !QUIET.has(a.state)).length,
      waiting: agents.filter((a) => a.state === 'waiting').length,
    },
  };
}
