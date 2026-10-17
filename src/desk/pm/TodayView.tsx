import { useMemo, useState } from 'react';
import { AgentFigure } from '../floor/AgentFigure';
import { DayItem } from './DayItem';
import { usePmRead } from './usePm';
import type { AlertKind, PmClientPulse, PmToday } from './types';
import { STATE_LABELS, type Floor, type FloorAgent } from '../types';
import { ago } from '../time';

interface Props {
  floor: Floor | null;
  /** Changes when the alerts do, so the day follows them. */
  version: string;
  onOpenScope: (scope: string) => void;
  onAssistant: (scope: string) => void;
  onAgent: (agent: FloorAgent) => void;
  onSnooze: (id: string, length: string) => Promise<void>;
  onOpenTask: (scope: string, id: string) => void;
}

const SIGNALS: Array<{ key: keyof PmToday['signals']; label: string; kinds: AlertKind[]; tone: string }> = [
  { key: 'waiting', label: 'waiting for you', kinds: ['approval', 'agent'], tone: 'attn' },
  { key: 'overdue', label: 'overdue', kinds: ['overdue'], tone: 'warn' },
  { key: 'due_today', label: 'due today', kinds: ['due_today'], tone: 'attn' },
  { key: 'reminders', label: 'reminders', kinds: ['reminder'], tone: 'attn' },
  { key: 'review', label: 'awaiting review', kinds: ['review'], tone: '' },
  { key: 'blocked', label: 'blocked', kinds: ['blocked'], tone: '' },
  { key: 'stale', label: 'stalled', kinds: ['stale'], tone: '' },
];

function longDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function since(iso: string): string {
  if (!iso) return '-';
  const age = ago(iso);
  return age === 'now' ? 'today' : `${age} ago`;
}

/**
 * The day across every client: who waits for you, what is late or due, what stalled, and
 * what is in hand - one list, so one screen answers "what now". Computed by `ws today`.
 */
export function TodayView({ floor, version, onOpenScope, onAssistant, onAgent, onSnooze, onOpenTask }: Props) {
  const { data, error } = usePmRead<PmToday>('desk/pm/today', version);
  const pulse = usePmRead<{ clients: PmClientPulse[] }>('desk/pm/clients', version);
  const [filter, setFilter] = useState<AlertKind[] | null>(null);
  const crew = useMemo(
    () => (floor?.zones ?? []).flatMap((z) => z.rooms.flatMap((r) => r.agents)).filter((a) => a.state !== 'idle' && a.state !== 'offline'),
    [floor],
  );

  if (error && !data) return <p className="desk-loading" role="alert">[ERROR] {error}</p>;
  if (!data) return <p className="desk-loading" role="status">Gathering today...</p>;
  const items = filter ? data.items.filter((item) => filter.includes(item.kind)) : data.items;

  return (
    <div className="pm-view" aria-label="Today">
      <header className="pm-head">
        <div>
          <p className="pm-kicker">Missions</p>
          <h1 className="pm-title">Today</h1>
        </div>
        <span className="pm-date">{longDay(data.date)}</span>
      </header>

      <div className="signals" role="group" aria-label="Signals">
        {SIGNALS.map((signal) => {
          const count = data.signals[signal.key] ?? 0;
          const on = filter !== null && filter.join() === signal.kinds.join();
          return (
            <button key={signal.key} type="button" aria-pressed={on} onClick={() => setFilter(on ? null : signal.kinds)}
              className={`signal${count && signal.tone ? ` is-${signal.tone}` : ''}${on ? ' is-on' : ''}`}>
              <b>{count}</b>
              <span>{signal.label}</span>
            </button>
          );
        })}
      </div>

      <div className="pm-grid">
        <section className="panel pm-day" aria-label="Your day">
          <h2 className="panel-title">
            Your day
            <span className="panel-sub"> · {filter ? `${items.length} shown` : 'people waiting first, then dates, then stalled work'}</span>
          </h2>
          {items.length === 0
            ? <p className="panel-empty">{filter ? 'Nothing of this kind.' : 'Nothing is waiting, late, or due. A clear day.'}</p>
            : (
              <ul className="day-list">
                {items.map((item) => (
                  <DayItem key={item.id} item={item} onOpenScope={onOpenScope} onAssistant={onAssistant} onSnooze={onSnooze} onOpenTask={onOpenTask} />
                ))}
              </ul>
            )}
        </section>

        <aside className="room-side">
          <section className="panel" aria-label="In hand">
            <h2 className="panel-title">In hand <span className="panel-sub">· {data.in_progress.length}</span></h2>
            {data.in_progress.length === 0 ? <p className="panel-empty">Nothing in progress.</p> : (
              <ul className="memory-list">
                {data.in_progress.slice(0, 8).map((task) => (
                  <li key={`${task.scope}:${task.id}`}>
                    <button type="button" className="mission-link" onClick={() => onOpenScope(task.scope)}>{task.scope}</button>
                    {' '}<button type="button" className="mission-link is-plain" onClick={() => onOpenTask(task.scope, task.id)}>{task.title}</button>
                    {task.assignee && <span className="memory-date"> · {task.assignee}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-label="Crew now">
            <h2 className="panel-title">Crew now <span className="panel-sub">· {crew.length} active</span></h2>
            {crew.length === 0 ? <p className="panel-empty">No agent is working right now.</p> : (
              <ul className="crew">
                {crew.slice(0, 6).map((agent) => (
                  <li key={agent.id}>
                    <button type="button" className="crew-member" onClick={() => onAgent(agent)}
                      aria-label={`${agent.tool} in ${agent.project}: ${STATE_LABELS[agent.state]}`}>
                      <AgentFigure key={agent.state} state={agent.state} tool={agent.tool} size={40} />
                      <span className="crew-name">{agent.tool} <span className="crew-detail">· {agent.project}</span></span>
                      <span className={`crew-state state-${agent.state}`}>{STATE_LABELS[agent.state]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-label="Client pulse">
            <h2 className="panel-title">Client pulse <span className="panel-sub">· open, overdue, last touch</span></h2>
            {!pulse.data ? <p className="panel-empty">{pulse.error ? `[ERROR] ${pulse.error}` : 'Reading clients...'}</p> : (
              <table className="pulse">
                <tbody>
                  {pulse.data.clients.map((client) => (
                    <tr key={client.key}>
                      <td><span className="chip">{client.key}</span></td>
                      <td>{client.open} open</td>
                      <td className={client.overdue ? 'is-warn' : ''}>{client.overdue ? `${client.overdue} overdue` : '-'}</td>
                      <td className="pulse-when">{since(client.lastInteraction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
