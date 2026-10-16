import type { ProjectDetail } from '../types';

/**
 * The mission board's stations: where work stands in an agent's day, not a generic
 * to-do/doing/done. Operator tasks may stand at any station; a run's plan step has only
 * pending, in progress, and done, so it stops at three of them.
 */
export type StationId = 'queue' | 'ready' | 'hands' | 'review' | 'shipped';

export interface Station {
  id: StationId;
  label: string;
  hint: string;
  taskStatus: string;
  planStatus: string | null;
}

export const STATIONS: Station[] = [
  { id: 'queue', label: 'Queue', hint: 'Waiting for its turn', taskStatus: 'backlog', planStatus: 'pending' },
  { id: 'ready', label: 'Ready for an agent', hint: 'Clear enough to hand off', taskStatus: 'ready', planStatus: null },
  { id: 'hands', label: 'In hands', hint: 'An agent is on it', taskStatus: 'in_progress', planStatus: 'in_progress' },
  { id: 'review', label: 'Awaiting review', hint: 'A person looks next', taskStatus: 'review', planStatus: null },
  { id: 'shipped', label: 'Shipped', hint: 'Done', taskStatus: 'done', planStatus: 'done' },
];

export interface Card {
  key: string;
  kind: 'task' | 'step';
  title: string;
  station: StationId;
  blocked: boolean;
  reason: string;
  revision: string;
  priority: string;
  owner: string;
  /** Task id, or the plan row number for a step. */
  ref: string;
  /** The run a step belongs to. */
  runId: string;
  runTitle: string;
}

const TASK_STATION: Record<string, StationId> = {
  backlog: 'queue', ready: 'ready', in_progress: 'hands', review: 'review', done: 'shipped',
};
const PLAN_STATION: Record<string, StationId> = {
  pending: 'queue', blocked: 'queue', in_progress: 'hands', done: 'shipped',
};

export function cardsFrom(detail: Pick<ProjectDetail, 'tasks' | 'plans'>): Card[] {
  const tasks: Card[] = detail.tasks.map((task) => ({
    key: `task:${task.id}`,
    kind: 'task',
    title: task.title,
    station: TASK_STATION[task.status] ?? 'queue',
    blocked: task.blocked === 'yes',
    reason: task.blockedReason ?? '',
    revision: task.revision,
    priority: task.priority ?? 'normal',
    owner: task.owner ?? '',
    ref: task.id,
    runId: '',
    runTitle: '',
  }));
  const steps: Card[] = detail.plans
    .filter((row) => row.task && row.status !== 'dropped' && PLAN_STATION[row.status])
    .map((row) => ({
      key: `step:${row.runId}#${row.n}`,
      kind: 'step',
      title: row.task,
      station: PLAN_STATION[row.status],
      blocked: row.status === 'blocked',
      reason: row.status === 'blocked' ? row.notes ?? '' : '',
      revision: row.revision,
      priority: 'normal',
      owner: '',
      ref: row.n,
      runId: row.runId,
      runTitle: row.run,
    }));
  return [...tasks, ...steps];
}

export function canMove(card: Card, to: StationId): boolean {
  if (card.station === to) return false;
  const station = STATIONS.find((s) => s.id === to);
  return Boolean(station && (card.kind === 'task' || station.planStatus));
}

/** The desk endpoint and body that move `card` to `to` through `ws`. */
export function moveRequest(card: Card, to: StationId, project: string): { path: string; body: Record<string, string> } {
  const station = STATIONS.find((s) => s.id === to)!;
  if (card.kind === 'task') {
    return { path: 'desk/tasks/status', body: { project, id: card.ref, status: station.taskStatus, revision: card.revision } };
  }
  return { path: 'desk/plan/status', body: { project, run: card.runId, n: card.ref, status: station.planStatus!, revision: card.revision } };
}

export type HoldMode = 'block' | 'drop';

/**
 * What can hold a card back: a task can be blocked, a plan step blocked or dropped. A card
 * already blocked is released instead, and shipped work is not held.
 */
export function holdActions(card: Card): HoldMode[] {
  if (card.blocked || card.station === 'shipped') return [];
  return card.kind === 'task' ? ['block'] : ['block', 'drop'];
}

/** The desk endpoint and body that hold `card` back with `reason`, through `ws`. */
export function holdRequest(card: Card, mode: HoldMode, reason: string, project: string): { path: string; body: Record<string, string> } {
  if (card.kind === 'task') {
    return { path: 'desk/tasks/block', body: { project, id: card.ref, reason, revision: card.revision } };
  }
  const status = mode === 'drop' ? 'dropped' : 'blocked';
  return { path: 'desk/plan/status', body: { project, run: card.runId, n: card.ref, status, notes: reason, revision: card.revision } };
}

/** The desk endpoint and body that free a blocked card: a task is unblocked, a step goes back to pending. */
export function releaseRequest(card: Card, project: string): { path: string; body: Record<string, string> } {
  if (card.kind === 'task') {
    return { path: 'desk/tasks/unblock', body: { project, id: card.ref, revision: card.revision } };
  }
  return { path: 'desk/plan/status', body: { project, run: card.runId, n: card.ref, status: 'pending', revision: card.revision } };
}
