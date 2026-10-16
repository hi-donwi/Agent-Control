/** The floor as `GET /api/agent/desk/floor` returns it; mirrors server/desk/floor.ts. */
export type ActivityState =
  | 'idle' | 'working' | 'thinking' | 'reading' | 'typing'
  | 'running' | 'learning' | 'waiting' | 'warning' | 'offline';

export interface FloorAgent {
  id: string;
  tool: string;
  project: string;
  state: ActivityState;
  detail: string;
  since: string;
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

/** What the written label under an avatar says for each state. */
export const STATE_LABELS: Record<ActivityState, string> = {
  idle: 'idle',
  working: 'working',
  thinking: 'thinking',
  reading: 'reading',
  typing: 'typing',
  running: 'running',
  learning: 'learning',
  waiting: 'needs you',
  warning: 'warning',
  offline: 'offline',
};

export const UNREGISTERED_ZONE = '-';

/** One project's room, as `GET /api/agent/desk/projects/:key` returns it. */
export interface ProjectDetail {
  key: string;
  client: string;
  group: string;
  description: string;
  folder: string;
  memory: {
    updated: string;
    stage: string;
    focus: string;
    nextUp: string[];
    blockedOn: Array<{ item: string; waitingFor: string; since: string }>;
    decisions: Array<{ date: string; title: string }>;
    log: Array<{ date: string; text: string }>;
    notes: Array<{ name: string; updated: string; excerpt: string }>;
  };
  tasks: Array<Record<string, string>>;
  plans: Array<Record<string, string>>;
  runs: Array<Record<string, string>>;
  approvals: Array<Record<string, string>>;
  agents: FloorAgent[];
  codingSession: { branch: string; worktree: string } | null;
  context: {
    pack: string[];
    policy: { default: string; actions: number; endpoints: string[] } | null;
  };
}
