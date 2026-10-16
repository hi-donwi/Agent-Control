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
  source: 'host' | 'clock';
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
