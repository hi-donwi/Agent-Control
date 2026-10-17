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
  lastActiveAt: string | null;
  idle: boolean;
  idleDays: number;
}

export interface FloorZone {
  client: string;
  rooms: FloorRoom[];
  idle: boolean;
}

export interface Floor {
  generatedAt: string;
  zones: FloorZone[];
  totals: {
    projects: number;
    agents: number;
    active: number;
    waiting: number;
    idleProjects?: number;
    activeProjects?: number;
  };
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
  lastActive?: Record<string, string | null>;
}

/** Clocks can name a project the registry does not list (the framework's own key). */
const UNREGISTERED = '-';
const QUIET: ReadonlySet<ActivityState> = new Set(['idle', 'offline']);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function buildFloor(input: FloorInput, now: Date): Floor {
  const rooms = new Map<string, FloorRoom & { client: string }>();
  const room = (key: string, client = UNREGISTERED) => {
    let entry = rooms.get(key);
    if (!entry) {
      entry = {
        key,
        client,
        group: '-',
        description: '',
        agents: [],
        pendingApprovals: 0,
        codingSession: false,
        lastActiveAt: null,
        idle: true,
        idleDays: 999,
      };
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

  const busy = (r: FloorRoom) => (r.agents.some((a) => !QUIET.has(a.state)) ? 1 : 0) + (r.pendingApprovals > 0 ? 1 : 0) + (r.codingSession ? 1 : 0);

  // Compute activity timestamps and idle state for each room.
  for (const r of rooms.values()) {
    let latestMs: number | null = null;
    if (input.lastActive && input.lastActive[r.key]) {
      const t = Date.parse(input.lastActive[r.key]!);
      if (Number.isFinite(t)) latestMs = t;
    }
    for (const a of r.agents) {
      const t = Date.parse(a.since);
      if (Number.isFinite(t) && (latestMs === null || t > latestMs)) {
        latestMs = t;
      }
    }
    if (input.approvals[r.key]?.requestedAt) {
      const t = Date.parse(input.approvals[r.key].requestedAt);
      if (Number.isFinite(t) && (latestMs === null || t > latestMs)) {
        latestMs = t;
      }
    }

    r.lastActiveAt = latestMs !== null ? new Date(latestMs).toISOString() : null;
    r.idleDays = latestMs !== null
      ? Math.max(0, Math.round(((now.getTime() - latestMs) / ONE_DAY_MS) * 10) / 10)
      : 999;
    const hasActiveSignal = busy(r) > 0;
    r.idle = !hasActiveSignal && (latestMs === null || (now.getTime() - latestMs) > ONE_DAY_MS);
  }

  const zones = new Map<string, FloorZone>();
  for (const { client, ...rest } of rooms.values()) {
    rest.agents.sort((a, b) => a.since.localeCompare(b.since));
    if (!zones.has(client)) zones.set(client, { client, rooms: [], idle: true });
    zones.get(client)!.rooms.push(rest);
  }
  const ordered = [...zones.values()];
  for (const zone of ordered) {
    zone.idle = zone.rooms.every((r) => r.idle);
    zone.rooms.sort((a, b) => (b.idle ? 0 : 1) - (a.idle ? 0 : 1) || busy(b) - busy(a) || b.agents.length - a.agents.length || a.key.localeCompare(b.key));
  }
  const zoneAgents = (z: FloorZone) => z.rooms.reduce((n, r) => n + r.agents.length, 0);
  const zoneActive = (z: FloorZone) => z.rooms.filter((r) => !r.idle).length;
  ordered.sort((a, b) =>
    (a.client === UNREGISTERED ? 1 : 0) - (b.client === UNREGISTERED ? 1 : 0)
    || (b.idle ? 0 : 1) - (a.idle ? 0 : 1)
    || zoneActive(b) - zoneActive(a)
    || zoneAgents(b) - zoneAgents(a)
    || a.client.localeCompare(b.client));

  const agents = ordered.flatMap((z) => z.rooms.flatMap((r) => r.agents));
  const allRooms = [...rooms.values()];
  const idleCount = allRooms.filter((r) => r.idle).length;
  return {
    generatedAt: now.toISOString(),
    zones: ordered,
    totals: {
      projects: rooms.size,
      agents: agents.length,
      active: agents.filter((a) => !QUIET.has(a.state)).length,
      waiting: agents.filter((a) => a.state === 'waiting').length,
      idleProjects: idleCount,
      activeProjects: allRooms.length - idleCount,
    },
  };
}
