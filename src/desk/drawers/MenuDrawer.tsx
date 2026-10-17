import { useMemo } from 'react';
import { Drawer } from './Drawer';
import { apiFetch } from '../../lib/api';
import { BackIcon, ChevronIcon, CloseIcon } from '../icons';
import { SectionView, type SectionCommands } from '../uidl/SectionView';
import { SECTIONS, sectionDocument, type SectionId } from '../uidl/documents';
import type { Floor, FloorRoom } from '../types';
import type { ThemePref } from '../useTheme';
import { DayItem } from '../pm/DayItem';
import type { PmAlert } from '../pm/types';
import type { PmPage } from '../pm/pages';

export type MenuSection = SectionId | 'settings' | 'inbox';

interface Props {
  floor: Floor | null;
  project: string;
  section: MenuSection | null;
  dark: boolean;
  theme: ThemePref;
  onProject: (key: string) => void;
  onSection: (section: MenuSection | null) => void;
  onFloor: () => void;
  onTheme: (theme: ThemePref) => void;
  onEndpoints: () => void;
  onClose: () => void;
  /** Computed alerts (ws alerts), for the Inbox. */
  alerts: PmAlert[];
  onSnooze: (id: string, length: string) => Promise<void>;
  /** Opens a project management view in the main area. */
  onPage: (page: PmPage) => void;
  onOpenScope: (scope: string) => void;
  onAssistantScope: (scope: string) => void;
  onOpenTask: (scope: string, id: string) => void;
}

const WORKSPACE_ITEMS: SectionId[] = ['projects', 'agents', 'approvals'];
const PROJECT_ITEMS: SectionId[] = ['context', 'memory', 'runs', 'tasks', 'notes'];

export function rooms(floor: Floor | null): FloorRoom[] {
  return (floor?.zones ?? []).flatMap((zone) => zone.rooms).sort((a, b) => a.key.localeCompare(b.key));
}

/** All navigation in one list; a section opens in place and the drawer widens. */
export function MenuDrawer(props: Props) {
  const { floor, project, section, onSection, onClose } = props;
  // Every write goes through the host to a `ws` command (ADR-0023); the section only names it.
  const commands = useMemo<SectionCommands>(() => ({
    'notes.add': (state) => {
      const note = (state.note ?? {}) as { title?: string; body?: string };
      return apiFetch('desk/notes', { method: 'POST', body: JSON.stringify({ project, title: note.title ?? '', body: note.body ?? '' }) });
    },
    'tasks.add': (state) => {
      const task = (state.task ?? {}) as { title?: string; priority?: string };
      return apiFetch('desk/tasks', { method: 'POST', body: JSON.stringify({ project, title: task.title ?? '', priority: task.priority ?? 'normal' }) });
    },
    'tasks.status': (_state, payload) =>
      apiFetch('desk/tasks/status', { method: 'POST', body: JSON.stringify({ ...payload, project }) }),
    'plans.status': (_state, payload) =>
      apiFetch('desk/plan/status', { method: 'POST', body: JSON.stringify({ ...payload, project }) }),
  }), [project]);
  const title = section ? (section === 'settings' ? 'Settings' : section === 'inbox' ? 'Inbox' : SECTIONS[section].title) : 'Menu';
  return (
    <Drawer label={title} wide={section !== null && section !== 'settings' && section !== 'inbox'} onClose={onClose}>
      <header className="drawer-head">
        {section && (
          <button type="button" className="icon-btn" onClick={() => onSection(null)} aria-label="Back to menu">
            <BackIcon />
          </button>
        )}
        <h2 className="drawer-title">
          {title}
          {section && section !== 'settings' && section !== 'inbox' && project && SECTIONS[section].scope === 'project' && (
            <span className="drawer-subtitle"> · {project}</span>
          )}
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
          <CloseIcon />
        </button>
      </header>
      {section !== 'inbox' && <ProjectPicker {...props} />}
      <div className="drawer-body">
        {section === null && <Nav {...props} />}
        {section === 'settings' && <Settings {...props} />}
        {section === 'inbox' && <Inbox {...props} />}
        {section && section !== 'settings' && section !== 'inbox' && (
          SECTIONS[section].scope === 'project' && !project
            ? <p className="drawer-empty">Choose a project above, or click a room on the floor.</p>
            : (
              <SectionView
                document={sectionDocument(section, project || undefined, rooms(floor).find((r) => r.key === project))}
                dark={props.dark}
                commands={commands}
              />
            )
        )}
      </div>
    </Drawer>
  );
}

function ProjectPicker({ floor, project, onProject }: Props) {
  return (
    <div className="drawer-scope">
      <label htmlFor="desk-project">Project</label>
      <select id="desk-project" value={project} onChange={(event) => onProject(event.target.value)}>
        <option value="">None selected</option>
        {rooms(floor).map((room) => <option key={room.key} value={room.key}>{room.key}</option>)}
      </select>
    </div>
  );
}

function Inbox({ alerts, onSnooze, onOpenScope, onAssistantScope, onOpenTask, onClose }: Props) {
  if (alerts.length === 0) return <p className="drawer-empty">Nothing waits: no approvals, late, due, stalled, or reminding work.</p>;
  return (
    <ul className="day-list" aria-label="Alerts">
      {alerts.map((alert) => (
        <DayItem
          key={alert.id}
          item={alert}
          compact
          onSnooze={onSnooze}
          onOpenScope={(scope) => { onClose(); onOpenScope(scope); }}
          onAssistant={(scope) => onAssistantScope(scope)}
          onOpenTask={(scope, id) => { onClose(); onOpenTask(scope, id); }}
        />
      ))}
    </ul>
  );
}

function Nav({ floor, project, onSection, onFloor, alerts, onPage }: Props) {
  const approvals = rooms(floor).reduce((n, room) => n + room.pendingApprovals, 0);
  const counts: Partial<Record<SectionId, number>> = {
    projects: floor?.totals.projects,
    agents: floor?.totals.agents,
    approvals,
  };
  const item = (id: SectionId) => (
    <li key={id}>
      <button type="button" className="nav-item" onClick={() => onSection(id)} disabled={SECTIONS[id].scope === 'project' && !project}>
        <span>{SECTIONS[id].title}</span>
        {counts[id] !== undefined && <span className={`nav-count${id === 'approvals' && approvals ? ' is-attn' : ''}`}>{counts[id]}</span>}
        <ChevronIcon />
      </button>
    </li>
  );
  return (
    <nav aria-label="Desk">
      <p className="nav-group">Missions</p>
      <ul className="nav-list">
        <li>
          <button type="button" className="nav-item" onClick={() => onSection('inbox')}>
            <span>Inbox</span>
            <span className={`nav-count${alerts.some((a) => a.severity !== 'info') ? ' is-attn' : ''}`}>{alerts.length}</span>
            <ChevronIcon />
          </button>
        </li>
        <li>
          <button type="button" className="nav-item" onClick={() => onPage('today')}>
            <span>Today</span>
            <ChevronIcon />
          </button>
        </li>
        <li>
          <button type="button" className="nav-item" onClick={() => onPage('missions')}>
            <span>Missions board</span>
            <ChevronIcon />
          </button>
        </li>
      </ul>
      <p className="nav-group">Workspace</p>
      <ul className="nav-list">
        <li>
          <button type="button" className="nav-item" onClick={onFloor}>
            <span>Floor</span>
            <ChevronIcon />
          </button>
        </li>
        {WORKSPACE_ITEMS.map(item)}
      </ul>
      <p className="nav-group">Project{project ? ` · ${project}` : ''}</p>
      <ul className="nav-list">{PROJECT_ITEMS.map(item)}</ul>
      <p className="nav-group">System</p>
      <ul className="nav-list">
        <li>
          <button type="button" className="nav-item" onClick={() => onSection('settings')}>
            <span>Settings</span>
            <ChevronIcon />
          </button>
        </li>
      </ul>
    </nav>
  );
}

function Settings({ theme, onTheme, onEndpoints }: Props) {
  const classic = new URL(window.location.href);
  classic.searchParams.set('ui', 'classic');
  return (
    <div className="settings">
      <fieldset className="segmented">
        <legend>Theme</legend>
        {(['light', 'dark', 'system'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={theme === value} onClick={() => onTheme(value)}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </fieldset>
      <div className="settings-row">
        <div>
          <p className="settings-label">Endpoints and keys</p>
          <p className="settings-hint">Legacy provider keys. Endpoints by protocol live in .local/agent/endpoints.json.</p>
        </div>
        <button type="button" className="btn" onClick={onEndpoints}>Open</button>
      </div>
      <div className="settings-row">
        <div>
          <p className="settings-label">Classic view</p>
          <p className="settings-hint">The previous single-chat layout, kept during the transition.</p>
        </div>
        <a className="btn" href={classic.toString()}>Switch</a>
      </div>
    </div>
  );
}
