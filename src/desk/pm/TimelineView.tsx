import { useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { nextWeek, timeline, weekOf } from './plan';
import { usePmRead } from './usePm';
import type { PmTask } from './types';

interface Props {
  version: string;
  onOpenTask: (scope: string, id: string) => void;
}

function localDay(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function label(day: string): { weekday: string; date: string } {
  const date = new Date(`${day}T12:00:00`);
  return { weekday: date.toLocaleDateString(undefined, { weekday: 'short' }), date: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) };
}

/**
 * The week on a calendar: due work and reminders on their day, what is late before it. Drag
 * an item to another day to move its due date, or a reminder's day at the same time.
 */
export function TimelineView({ version, onOpenTask }: Props) {
  const today = localDay();
  const [anchor, setAnchor] = useState(today);
  const [reloads, setReloads] = useState(0);
  const [dragging, setDragging] = useState<PmTask | null>(null);
  const [moveError, setMoveError] = useState('');
  const { data, error } = usePmRead<{ tasks: PmTask[] }>('desk/pm/tasks', `${version}:${reloads}`);
  const days = useMemo(() => weekOf(anchor), [anchor]);
  const placed = useMemo(() => timeline(data?.tasks ?? [], days), [data, days]);

  const moveTo = async (task: PmTask, day: string) => {
    const changes = task.remind_at ? { remind_at: `${day} ${task.remind_at.slice(11, 16)}` } : { due: day };
    try {
      await apiFetch('desk/pm/tasks/edit', { method: 'POST', body: JSON.stringify({ scope: task.scope, id: task.id, revision: task.revision, changes }) });
      setMoveError('');
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloads((n) => n + 1);
    }
  };

  const item = (task: PmTask) => (
    <li key={`${task.scope}:${task.id}`} draggable onDragStart={() => setDragging(task)} onDragEnd={() => setDragging(null)}
      className={`tl-item${task.kind === 'reminder' ? ' is-reminder' : ''}${task.status === 'done' ? ' is-done' : ''}`}>
      <button type="button" className="mission-open" onClick={() => onOpenTask(task.scope, task.id)}
        aria-label={`${task.kind === 'reminder' ? 'Reminder' : 'Due'}: ${task.title}`}>
        <span className="tl-title">{task.remind_at && <b>{task.remind_at.slice(11, 16)} </b>}{task.title}</span>
        <span className="tl-scope">{task.scope}</span>
      </button>
    </li>
  );

  return (
    <div className="pm-view" aria-label="Timeline">
      <header className="pm-head">
        <div>
          <p className="pm-kicker">Missions</p>
          <h1 className="pm-title">Timeline</h1>
        </div>
        <div className="tl-nav" role="group" aria-label="Week">
          <button type="button" className="btn" onClick={() => setAnchor(nextWeek(anchor, -1))}>Previous week</button>
          <button type="button" className="btn" onClick={() => setAnchor(today)}>This week</button>
          <button type="button" className="btn" onClick={() => setAnchor(nextWeek(anchor, 1))}>Next week</button>
        </div>
      </header>
      {moveError && <p className="board-error" role="alert">[ERROR] {moveError}</p>}
      {error && !data && <p className="board-error" role="alert">[ERROR] {error}</p>}
      {!data ? <p className="desk-loading" role="status">Reading dates...</p> : (
        <div className="tl-grid">
          <section className="tl-day is-earlier" aria-label="Earlier, not done">
            <h2 className="tl-head"><span>Earlier</span><small>late</small></h2>
            <ol>{placed.earlier.map(item)}</ol>
          </section>
          {days.map((day) => {
            const { weekday, date } = label(day);
            return (
              <section key={day} aria-label={`${weekday} ${day}`} className={`tl-day${day === today ? ' is-today' : ''}${dragging ? ' is-target' : ''}`}
                onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragging) void moveTo(dragging, day); setDragging(null); }}>
                <h2 className="tl-head"><span>{weekday}</span><small>{date}</small></h2>
                <ol>{placed.days[day].map(item)}</ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
