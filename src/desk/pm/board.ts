import type { StationId } from '../room/stations';
import type { PmTask } from './types';

/**
 * The Missions board across every client (ADR-0024): the project room's stations as
 * columns, one lane per client, project, or assignee. Pure, so it is tested without a page.
 */
export type LaneBy = 'client' | 'project' | 'assignee';

export const STATION_OF: Record<PmTask['status'], StationId> = {
  backlog: 'queue', ready: 'ready', in_progress: 'hands', review: 'review', done: 'shipped',
};
export const STATUS_OF: Record<StationId, PmTask['status']> = {
  queue: 'backlog', ready: 'ready', hands: 'in_progress', review: 'review', shipped: 'done',
};

export interface BoardFilters {
  client?: string;
  assignee?: string;
  label?: string;
  query?: string;
  due?: '' | 'late' | 'week';
}

export interface Lane {
  key: string;
  label: string;
  tasks: PmTask[];
  open: number;
  overdue: number;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** How a due date reads today: late, today, within a week, or nothing to say. */
export function dueTone(task: Pick<PmTask, 'due' | 'status'>, today: string): '' | 'late' | 'today' | 'soon' {
  if (!task.due || task.status === 'done') return '';
  if (task.due < today) return 'late';
  if (task.due === today) return 'today';
  return task.due <= addDays(today, 7) ? 'soon' : '';
}

export function filterTasks(tasks: PmTask[], filters: BoardFilters, today: string): PmTask[] {
  const query = (filters.query ?? '').trim().toLowerCase();
  return tasks.filter((task) =>
    (!filters.client || task.client === filters.client)
    && (!filters.assignee || task.assignee === filters.assignee)
    && (!filters.label || task.labels.includes(filters.label))
    && (!query || `${task.title} ${task.id} ${task.scope}`.toLowerCase().includes(query))
    && (!filters.due || (filters.due === 'late' ? dueTone(task, today) === 'late' : ['late', 'today', 'soon'].includes(dueTone(task, today)))));
}

function laneKey(task: PmTask, by: LaneBy): string {
  if (by === 'project') return task.scope;
  if (by === 'assignee') return task.assignee || '';
  return task.client || '';
}

/** Lanes in name order, the unnamed one ("no client", "unassigned") last. */
export function lanesOf(tasks: PmTask[], by: LaneBy, today: string): Lane[] {
  const groups = new Map<string, PmTask[]>();
  for (const task of tasks) {
    const key = laneKey(task, by);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const empty = by === 'assignee' ? 'unassigned' : by === 'client' ? 'no client' : 'no project';
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, laneTasks]) => ({
      key,
      label: key || empty,
      tasks: laneTasks,
      open: laneTasks.filter((t) => t.status !== 'done').length,
      overdue: laneTasks.filter((t) => dueTone(t, today) === 'late').length,
    }));
}

/** A station's cards: ranked work first, then by due date; shipped work newest first, capped. */
export function cardsAt(lane: Lane, station: StationId, shippedShown = 6): PmTask[] {
  const here = lane.tasks.filter((t) => STATION_OF[t.status] === station);
  if (station === 'shipped') return [...here].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, shippedShown);
  return [...here].sort((a, b) => (a.rank === 0 ? 1 : 0) - (b.rank === 0 ? 1 : 0) || a.rank - b.rank || (a.due || '9999').localeCompare(b.due || '9999') || a.id.localeCompare(b.id));
}
