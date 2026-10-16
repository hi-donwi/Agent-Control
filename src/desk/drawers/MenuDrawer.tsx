import { useMemo } from 'react';
import { Drawer } from './Drawer';
import { apiFetch } from '../../lib/api';
import { BackIcon, ChevronIcon, CloseIcon } from '../icons';
import { SectionView, type SectionCommands } from '../uidl/SectionView';
import { SECTIONS, sectionDocument, type SectionId } from '../uidl/documents';
import type { Floor, FloorRoom } from '../types';
import type { ThemePref } from '../useTheme';

export type MenuSection = SectionId | 'settings';

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
  }), [project]);
  const title = section ? (section === 'settings' ? 'Settings' : SECTIONS[section].title) : 'Menu';
  return (
    <Drawer label={title} wide={section !== null && section !== 'settings'} onClose={onClose}>
      <header className="drawer-head">
        {section && (
          <button type="button" className="icon-btn" onClick={() => onSection(null)} aria-label="Back to menu">
            <BackIcon />
          </button>
        )}
        <h2 className="drawer-title">
          {title}
          {section && section !== 'settings' && project && SECTIONS[section].scope === 'project' && (
            <span className="drawer-subtitle"> · {project}</span>
          )}
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
          <CloseIcon />
        </button>
      </header>
      <ProjectPicker {...props} />
      <div className="drawer-body">
        {section === null && <Nav {...props} />}
        {section === 'settings' && <Settings {...props} />}
        {section && section !== 'settings' && (
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

function Nav({ floor, project, onSection, onFloor }: Props) {
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
