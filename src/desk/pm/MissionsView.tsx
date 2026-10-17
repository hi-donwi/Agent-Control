import { useMemo, useState, type DragEvent } from 'react';
import { apiFetch } from '../../lib/api';
import { StationGlyph } from '../room/glyphs';
import { STATIONS, type StationId } from '../room/stations';
import { STATION_OF, STATUS_OF, cardsAt, filterTasks, lanesOf, type BoardFilters, type LaneBy } from './board';
import { MissionCard } from './MissionCard';
import { QuickAdd } from './QuickAdd';
import { usePmRead } from './usePm';
import type { PmClientPulse, PmTask } from './types';

interface Props {
  projects: string[];
  /** Changes when alerts or the task drawer change something, so the board follows. */
  version: string;
  onOpenTask: (scope: string, id: string) => void;
}

function localDay(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Every client's work on one board: the project room's stations as columns, one lane per
 * client (or project, or assignee). Drag a card along its lane to move it; open it to change
 * anything else. Reads `ws task list --all`; every move is `ws task status` with a revision.
 */
export function MissionsView({ projects, version, onOpenTask }: Props) {
  const [reloads, setReloads] = useState(0);
  const { data, error } = usePmRead<{ tasks: PmTask[] }>('desk/pm/tasks', `${version}:${reloads}`);
  const clients = usePmRead<{ clients: PmClientPulse[] }>('desk/pm/clients', version);
  const [by, setBy] = useState<LaneBy>('client');
  const [filters, setFilters] = useState<BoardFilters>({});
  const [dragging, setDragging] = useState<PmTask | null>(null);
  const [moveError, setMoveError] = useState('');
  const today = localDay();

  const tasks = useMemo(() => filterTasks(data?.tasks ?? [], filters, today), [data, filters, today]);
  const lanes = useMemo(() => lanesOf(tasks, by, today), [tasks, by, today]);
  const assignees = useMemo(() => [...new Set((data?.tasks ?? []).map((t) => t.assignee).filter(Boolean))].sort(), [data]);
  const labels = useMemo(() => [...new Set((data?.tasks ?? []).flatMap((t) => t.labels))].sort(), [data]);
  const clientKeys = (clients.data?.clients ?? []).map((c) => c.key);

  const drop = async (event: DragEvent, laneKey: string, station: StationId) => {
    event.preventDefault();
    const task = dragging;
    setDragging(null);
    if (!task || STATION_OF[task.status] === station) return;
    const sameLane = by === 'client' ? task.client === laneKey : by === 'project' ? task.scope === laneKey : task.assignee === laneKey;
    if (!sameLane) return;
    try {
      await apiFetch('desk/pm/tasks/status', { method: 'POST', body: JSON.stringify({ scope: task.scope, id: task.id, status: STATUS_OF[station], revision: task.revision }) });
      setMoveError('');
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloads((n) => n + 1);
    }
  };

  const set = (patch: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="pm-view" aria-label="Missions board">
      <header className="pm-head">
        <div>
          <p className="pm-kicker">Missions</p>
          <h1 className="pm-title">Missions board</h1>
        </div>
        <span className="pm-date">{tasks.filter((t) => t.status !== 'done').length} open across {lanes.length} {by === 'client' ? 'clients' : by === 'project' ? 'projects' : 'assignees'}</span>
      </header>

      <div className="board-tools">
        <QuickAdd projects={projects} clients={clientKeys} onAdded={() => setReloads((n) => n + 1)} />
        <div className="board-filters" role="group" aria-label="Board filters">
          <select aria-label="Lanes" value={by} onChange={(e) => setBy(e.target.value as LaneBy)}>
            <option value="client">Lanes: client</option>
            <option value="project">Lanes: project</option>
            <option value="assignee">Lanes: assignee</option>
          </select>
          <select aria-label="Client" value={filters.client ?? ''} onChange={(e) => set({ client: e.target.value || undefined })}>
            <option value="">Every client</option>
            {clientKeys.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Assignee" value={filters.assignee ?? ''} onChange={(e) => set({ assignee: e.target.value || undefined })}>
            <option value="">Anyone</option>
            {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select aria-label="Label" value={filters.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })}>
            <option value="">Any label</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select aria-label="Due" value={filters.due ?? ''} onChange={(e) => set({ due: e.target.value as BoardFilters['due'] })}>
            <option value="">Any date</option>
            <option value="late">Late</option>
            <option value="week">Due within a week</option>
          </select>
          <input type="search" aria-label="Search missions" placeholder="Search..." value={filters.query ?? ''} onChange={(e) => set({ query: e.target.value })} />
        </div>
      </div>

      {moveError && <p className="board-error" role="alert">[ERROR] {moveError}</p>}
      {error && !data && <p className="board-error" role="alert">[ERROR] {error}</p>}
      {!data ? <p className="desk-loading" role="status">Reading every client's work...</p> : (
        <div className="portfolio" aria-label="Missions by station">
          <div className="portfolio-row portfolio-head" aria-hidden="true">
            <span className="lane-head-spacer" />
            {STATIONS.map((s) => (
              <span key={s.id} className="station-head"><span className="station-glyph"><StationGlyph id={s.id} /></span><span className="station-name">{s.label}</span></span>
            ))}
          </div>
          {lanes.length === 0 && <p className="panel-empty">No missions match. Add one above, or clear the filters.</p>}
          {lanes.map((lane) => (
            <section key={lane.key || '-'} className="portfolio-row" aria-label={`Lane ${lane.label}`}>
              <div className="lane-head">
                <b>{lane.label}</b>
                <span>{lane.open} open{lane.overdue ? ` · ${lane.overdue} late` : ''}</span>
              </div>
              {STATIONS.map((s) => {
                const cards = cardsAt(lane, s.id);
                const target = dragging !== null && STATION_OF[dragging.status] !== s.id;
                return (
                  <section key={s.id} aria-label={`${lane.label}, ${s.label}`} className={`portfolio-cell${target ? ' is-target' : ''}`}
                    onDragOver={(e) => { if (target) e.preventDefault(); }} onDrop={(e) => void drop(e, lane.key, s.id)}>
                    <ol className="station-cards">
                      {cards.map((task) => (
                        <MissionCard key={`${task.scope}:${task.id}`} task={task} today={today} showScope={by !== 'project'}
                          dragging={dragging?.id === task.id} onOpen={() => onOpenTask(task.scope, task.id)}
                          onDragStart={() => setDragging(task)} onDragEnd={() => setDragging(null)} />
                      ))}
                    </ol>
                  </section>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
