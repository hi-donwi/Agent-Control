/** The shapes `ws today`, `ws alerts`, `ws task ... --json`, and `ws client show` answer with (ADR-0024). */

export type AlertKind = 'approval' | 'agent' | 'overdue' | 'reminder' | 'due_today' | 'review' | 'blocked' | 'stale';

export interface PmAlert {
  id: string;
  kind: AlertKind;
  severity: 'attn' | 'warn' | 'info';
  scope: string;
  client: string;
  title: string;
  detail: string;
  ref: string;
  at: string;
}

export interface PmTask {
  id: string;
  title: string;
  scope: string;
  project: string;
  client: string;
  status: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  kind: 'task' | 'milestone' | 'reminder';
  owner: string;
  assignee: string;
  due: string;
  remind_at: string;
  recur: string;
  rank: number;
  parent: string;
  depends_on: string[];
  labels: string[];
  acceptance_criteria: string[];
  blocked: boolean;
  blocked_reason: string;
  description: string;
  checklist: Array<{ n: number; done: boolean; text: string }>;
  activity: Array<{ at: string; actor: string; text: string }>;
  progress?: { done: number; total: number };
  revision: string;
  updated_at: string;
  created_at: string;
}

export interface PmToday {
  date: string;
  signals: Record<'overdue' | 'due_today' | 'waiting' | 'blocked' | 'stale' | 'review' | 'reminders', number>;
  items: PmAlert[];
  in_progress: PmTask[];
}

export interface PmClientPulse {
  key: string;
  name: string;
  projects: number;
  open: number;
  overdue: number;
  alerts: number;
  lastInteraction: string;
  error?: string;
}
