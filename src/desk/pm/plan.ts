import type { PmTask } from './types';

/**
 * The Backlog and the Timeline (ADR-0024: a ranked backlog with due dates and milestones,
 * no sprints). Pure helpers, tested without a page.
 */

/** Ranked work first (lower rank earlier), then by due date, then by id. */
export function byRank(a: PmTask, b: PmTask): number {
  return (a.rank === 0 ? 1 : 0) - (b.rank === 0 ? 1 : 0) || a.rank - b.rank
    || (a.due || '9999').localeCompare(b.due || '9999') || a.id.localeCompare(b.id);
}

export interface BacklogGroup {
  key: string;
  label: string;
  tasks: PmTask[];
}

/** Open work that is not a milestone, grouped by client or by milestone, each group ranked. */
export function backlogGroups(tasks: PmTask[], by: 'client' | 'milestone'): BacklogGroup[] {
  const open = tasks.filter((t) => t.status !== 'done' && t.kind !== 'milestone');
  const titles = new Map(tasks.filter((t) => t.kind === 'milestone').map((t) => [t.id, t.title]));
  const groups = new Map<string, PmTask[]>();
  for (const task of open) {
    const key = by === 'client' ? task.client : titles.has(task.parent) ? task.parent : '';
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const empty = by === 'client' ? 'no client' : 'no milestone';
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : (titles.get(a) ?? a).localeCompare(titles.get(b) ?? b)))
    .map(([key, group]) => ({ key, label: key ? titles.get(key) ?? key : empty, tasks: [...group].sort(byRank) }));
}

/**
 * The ranks that put `id` at `index` in `group`: every task numbered 1..n in the new order,
 * returning only the ones whose rank changes, so a move costs as few writes as it can.
 */
export function reorder(group: PmTask[], id: string, index: number): Array<{ task: PmTask; rank: number }> {
  const moving = group.find((t) => t.id === id);
  if (!moving) return [];
  const rest = group.filter((t) => t.id !== id);
  const order = [...rest.slice(0, index), moving, ...rest.slice(index)];
  return order.map((task, i) => ({ task, rank: i + 1 })).filter(({ task, rank }) => task.rank !== rank);
}

export function milestones(tasks: PmTask[]): PmTask[] {
  return tasks.filter((t) => t.kind === 'milestone').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.id.localeCompare(b.id));
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The seven days of the week holding `day`, Monday first. */
export function weekOf(day: string): string[] {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = shift(day, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shift(monday, i));
}

export function nextWeek(day: string, weeks: number): string {
  return shift(day, weeks * 7);
}

/** The day a task stands on the timeline: a reminder's day, else its due date. */
export function dayOf(task: PmTask): string {
  return task.remind_at ? task.remind_at.slice(0, 10) : task.due;
}

/** Open work placed on `days`; what fell before the first day and is not done is "earlier". */
export function timeline(tasks: PmTask[], days: string[]): { earlier: PmTask[]; days: Record<string, PmTask[]> } {
  const placed: Record<string, PmTask[]> = Object.fromEntries(days.map((d) => [d, []]));
  const earlier: PmTask[] = [];
  for (const task of tasks) {
    const day = dayOf(task);
    if (!day || task.status === 'done' && !(day in placed)) continue;
    if (day in placed) placed[day].push(task);
    else if (day < days[0] && task.status !== 'done') earlier.push(task);
  }
  for (const list of Object.values(placed)) list.sort((a, b) => (a.remind_at || '').localeCompare(b.remind_at || '') || byRank(a, b));
  return { earlier: earlier.sort((a, b) => dayOf(a).localeCompare(dayOf(b))), days: placed };
}
