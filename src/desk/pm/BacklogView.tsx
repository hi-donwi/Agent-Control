import { useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { QuickAdd } from './QuickAdd';
import { backlogGroups, milestones, reorder } from './plan';
import { dueTone } from './board';
import { usePmRead } from './usePm';
import type { PmClientPulse, PmTask } from './types';

interface Props {
  projects: string[];
  version: string;
  onOpenTask: (scope: string, id: string) => void;
  taskDraft?: { scope: string; title: string } | null;
  onTaskDraftConsumed?: () => void;
}

function localDay(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Everything not yet done, ranked by hand, per client or per milestone, with the milestones
 * and how far each has come. The rank is a field of the task, so agents read the same order.
 */
export function BacklogView({ projects, version, onOpenTask, taskDraft, onTaskDraftConsumed }: Props) {
  const [reloads, setReloads] = useState(0);
  const { data, error } = usePmRead<{ tasks: PmTask[] }>('desk/pm/tasks', `${version}:${reloads}`);
  const clients = usePmRead<{ clients: PmClientPulse[] }>('desk/pm/clients', version);
  const [by, setBy] = useState<'client' | 'milestone'>('client');
  const [dragging, setDragging] = useState<{ id: string; group: string } | null>(null);
  const [moveError, setMoveError] = useState('');
  const today = localDay();
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const groups = useMemo(() => backlogGroups(tasks, by), [tasks, by]);
  const stones = useMemo(() => milestones(tasks), [tasks]);

  const move = async (group: PmTask[], id: string, index: number) => {
    try {
      // One edit per task whose rank changes, each with the revision the list read.
      for (const { task, rank } of reorder(group, id, index)) {
        await apiFetch('desk/pm/tasks/edit', { method: 'POST', body: JSON.stringify({ scope: task.scope, id: task.id, revision: task.revision, changes: { rank } }) });
      }
      setMoveError('');
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloads((n) => n + 1);
    }
  };

  return (
    <div className="pm-view" aria-label="Backlog">
      <header className="pm-head">
        <div>
          <p className="pm-kicker">Missions</p>
          <h1 className="pm-title">Backlog</h1>
        </div>
        <span className="pm-date">{groups.reduce((n, g) => n + g.tasks.length, 0)} open, ranked by hand</span>
      </header>
      <div className="board-tools">
        <QuickAdd
          projects={projects}
          clients={(clients.data?.clients ?? []).map((c) => c.key)}
          draft={taskDraft}
          onDraftConsumed={onTaskDraftConsumed}
          onAdded={() => setReloads((n) => n + 1)}
        />
        <div className="board-filters">
          <select aria-label="Group by" value={by} onChange={(e) => setBy(e.target.value as 'client' | 'milestone')}>
            <option value="client">Group: client</option>
            <option value="milestone">Group: milestone</option>
          </select>
        </div>
      </div>
      {moveError && <p className="board-error" role="alert">[ERROR] {moveError}</p>}
      {error && !data && <p className="board-error" role="alert">[ERROR] {error}</p>}

      {stones.length > 0 && (
        <section className="panel" aria-label="Milestones">
          <h2 className="panel-title">Milestones</h2>
          <ul className="milestones">
            {stones.map((m) => {
              const progress = m.progress ?? { done: 0, total: 0 };
              const share = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
              return (
                <li key={`${m.scope}:${m.id}`}>
                  <button type="button" className="milestone" onClick={() => onOpenTask(m.scope, m.id)} aria-label={`Milestone: ${m.title}`}>
                    <span className="milestone-title">{m.title}<span className="chip">{m.scope}</span></span>
                    <span className="milestone-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                    <span className="milestone-meta">{progress.done}/{progress.total} done{m.due ? ` · due ${m.due}` : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!data ? <p className="desk-loading" role="status">Reading the backlog...</p> : groups.map((group) => (
        <section key={group.key || '-'} className="panel backlog-group" aria-label={`Backlog ${group.label}`}>
          <h2 className="panel-title">{group.label} <span className="panel-sub">· {group.tasks.length}</span></h2>
          <ol className="backlog-list">
            {group.tasks.map((task, index) => (
              <li key={`${task.scope}:${task.id}`} draggable aria-label={`Rank ${index + 1}: ${task.title}`}
                className={`backlog-row priority-${task.priority}${dragging?.id === task.id ? ' is-dragging' : ''}`}
                onDragStart={() => setDragging({ id: task.id, group: group.key })} onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { if (dragging?.group === group.key) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragging?.group === group.key) void move(group.tasks, dragging.id, index); setDragging(null); }}>
                <span className="backlog-grip" aria-hidden="true">::</span>
                <button type="button" className="mission-link is-plain backlog-title" onClick={() => onOpenTask(task.scope, task.id)}>{task.title}</button>
                <span className="chip">{task.scope}</span>
                <span className="backlog-cell">{task.priority}</span>
                <span className={`backlog-cell mission-due is-${dueTone(task, today) || 'later'}`}>{task.due || '-'}</span>
                <span className="backlog-cell">{task.assignee || '-'}</span>
                <span className="backlog-moves">
                  <button type="button" className="icon-btn" disabled={index === 0} aria-label={`Move ${task.title} up`} onClick={() => void move(group.tasks, task.id, index - 1)}>^</button>
                  <button type="button" className="icon-btn" disabled={index === group.tasks.length - 1} aria-label={`Move ${task.title} down`} onClick={() => void move(group.tasks, task.id, index + 1)}>v</button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
