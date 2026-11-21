import { useEffect, useMemo, useState } from 'react';
import { Drawer } from './Drawer';
import {
  apiFetch, chooseDesktopWorkspace, clearDesktopToolOverride, getDesktopHostStatus,
  getDesktopAutostartStatus, getDesktopTools, getDesktopWorkspaceRoot,
  refreshDesktopToolsFromLoginShell, setDesktopAutostart, setDesktopToolOverride,
} from '../../lib/api';
import type { DesktopToolName, DesktopToolStatus } from '../../lib/desktop-tools';
import { BackIcon, ChevronIcon, CloseIcon } from '../icons';
import { SectionView, type SectionCommands } from '../uidl/SectionView';
import { SECTIONS, sectionDocument, type SectionId } from '../uidl/documents';
import type { Floor, FloorRoom } from '../types';
import type { ThemePref } from '../useTheme';
import { DayItem } from '../pm/DayItem';
import type { PmAlert } from '../pm/types';
import type { PmPage } from '../pm/pages';
import type { NoteDraft } from '../command/command-state';
import type { SuiteManifest, SuiteComponentState } from '../../lib/suite';
import type { DesktopHostStatus } from '../../lib/desktop-bootstrap';
import { BrainManagement } from './BrainManagement';

export type MenuSection = SectionId | 'settings' | 'inbox';

interface Props {
  floor: Floor | null;
  project: string;
  section: MenuSection | null;
  noteDraft?: NoteDraft & { id: string };
  noteDraftKey?: string;
  dark: boolean;
  theme: ThemePref;
  onProject: (key: string) => void;
  onSection: (section: MenuSection | null) => void;
  onFloor: () => void;
  onTheme: (theme: ThemePref) => void;
  onClose: () => void;
  /** Computed alerts (ws alerts), for the Inbox. */
  alerts: PmAlert[];
  onSnooze: (id: string, length: string) => Promise<void>;
  /** Opens a project management view in the main area. */
  onPage: (page: PmPage) => void;
  onOpenScope: (scope: string) => void;
  onAssistantScope: (scope: string) => void;
  onOpenTask: (scope: string, id: string) => void;
  onNoteDraftSaved?: () => void;
}

const WORKSPACE_ITEMS: SectionId[] = ['projects', 'agents', 'approvals'];
const PROJECT_ITEMS: SectionId[] = ['context', 'memory', 'runs', 'tasks', 'notes'];

export function rooms(floor: Floor | null): FloorRoom[] {
  return (floor?.zones ?? []).flatMap((zone) => zone.rooms).sort((a, b) => a.key.localeCompare(b.key));
}

/** All navigation in one list; a section opens in place and the drawer widens. */
export function MenuDrawer(props: Props) {
  const { floor, project, section, onSection, onClose, noteDraft, onNoteDraftSaved } = props;
  // Every write goes through the host to a `ws` command (ADR-0023); the section only names it.
  const commands = useMemo<SectionCommands>(() => ({
    'notes.add': async (state) => {
      const note = (state.note ?? {}) as { title?: string; body?: string };
      const result = await apiFetch('desk/notes', { method: 'POST', body: JSON.stringify({ project, title: note.title ?? '', body: note.body ?? '' }) });
      if (noteDraft) onNoteDraftSaved?.();
      return result;
    },
    'tasks.add': (state) => {
      const task = (state.task ?? {}) as { title?: string; priority?: string };
      return apiFetch('desk/tasks', { method: 'POST', body: JSON.stringify({ project, title: task.title ?? '', priority: task.priority ?? 'normal' }) });
    },
    'tasks.status': (_state, payload) =>
      apiFetch('desk/tasks/status', { method: 'POST', body: JSON.stringify({ ...payload, project }) }),
    'plans.status': (_state, payload) =>
      apiFetch('desk/plan/status', { method: 'POST', body: JSON.stringify({ ...payload, project }) }),
  }), [noteDraft, onNoteDraftSaved, project]);
  const title = section ? (section === 'settings' ? 'Settings' : section === 'inbox' ? 'Inbox' : SECTIONS[section].title) : 'Menu';
  return (
    <Drawer label={title} wide={section !== null && section !== 'inbox'} onClose={onClose}>
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
      {section !== 'inbox' && <ProjectPicker {...props} disabled={Boolean(noteDraft)} />}
      <div className="drawer-body">
        {section === null && <Nav {...props} />}
        {section === 'settings' && <Settings {...props} />}
        {section === 'inbox' && <Inbox {...props} />}
        {section && section !== 'settings' && section !== 'inbox' && (
          SECTIONS[section].scope === 'project' && !project
            ? <p className="drawer-empty">Choose a project above, or click a room on the floor.</p>
            : (
              <SectionView
                key={`${section}:${props.noteDraftKey ?? ''}`}
                document={sectionDocument(section, project || undefined, rooms(floor).find((r) => r.key === project))}
                dark={props.dark}
                commands={commands}
                initialState={section === 'notes' && noteDraft ? { note: { title: noteDraft.title, body: noteDraft.body } } : undefined}
              />
            )
        )}
      </div>
    </Drawer>
  );
}

function ProjectPicker({ floor, project, onProject, disabled }: Props & { disabled?: boolean }) {
  return (
    <div className="drawer-scope">
      <label htmlFor="desk-project">Project</label>
      <select id="desk-project" value={project} onChange={(event) => onProject(event.target.value)} disabled={disabled}>
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
        <li>
          <button type="button" className="nav-item" onClick={() => onPage('backlog')}>
            <span>Backlog</span>
            <ChevronIcon />
          </button>
        </li>
        <li>
          <button type="button" className="nav-item" onClick={() => onPage('timeline')}>
            <span>Timeline</span>
            <ChevronIcon />
          </button>
        </li>
        <li>
          <button type="button" className="nav-item" onClick={() => onPage('clients')}>
            <span>Clients</span>
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

function useSuiteManifest() {
  const [manifest, setManifest] = useState<SuiteManifest | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void apiFetch<SuiteManifest>('suite')
      .then((value) => { if (current) setManifest(value); })
      .catch(() => { if (current) setError('Component status is unavailable. The suite continues to work without this summary.'); });
    return () => { current = false; };
  }, []);
  return { manifest, error };
}

const SUITE_STATE_LABEL: Record<SuiteComponentState, string> = {
  ready: 'Ready',
  configured: 'Configured',
  'not-configured': 'Not configured',
  'not-installed': 'Not installed',
};

const REQUIRED_TOOLS: DesktopToolName[] = ['ws', 'brain', 'rg', 'git'];

function Settings({ theme, onTheme }: Props) {
  const [workspacePending, setWorkspacePending] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [hostStatus, setHostStatus] = useState<DesktopHostStatus | null>(null);
  const [desktopHostSupported, setDesktopHostSupported] = useState(false);
  const [tools, setTools] = useState<DesktopToolStatus[]>([]);
  const [toolPaths, setToolPaths] = useState<Partial<Record<DesktopToolName, string>>>({});
  const [toolError, setToolError] = useState('');
  const [toolMessage, setToolMessage] = useState('');
  const [toolPending, setToolPending] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartSupported, setAutostartSupported] = useState(false);
  const [autostartPending, setAutostartPending] = useState(false);
  const [autostartError, setAutostartError] = useState('');
  const { manifest: suite, error: suiteError } = useSuiteManifest();
  const workspaceRoot = getDesktopWorkspaceRoot();
  const classic = new URL(window.location.href);
  classic.searchParams.set('ui', 'classic');

  useEffect(() => {
    if (!workspaceRoot) return;
    let current = true;
    const refresh = async () => {
      try {
        const status = await getDesktopHostStatus();
        if (current && status) {
          setDesktopHostSupported(true);
          setHostStatus(status);
        } else if (current) setDesktopHostSupported(false);
      } catch {
        if (current) {
          setDesktopHostSupported(true);
          setHostStatus({ lifecycle: 'restarting', restartCount: 0, lastExitCode: null });
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { current = false; window.clearInterval(timer); };
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return;
    let current = true;
    void getDesktopAutostartStatus().then((enabled) => {
      if (current) {
        setAutostartSupported(enabled !== null);
        setAutostartEnabled(enabled);
      }
    }).catch(() => {
      if (current) {
        setAutostartSupported(true);
        setAutostartError('Launch-at-login status is unavailable.');
      }
    });
    return () => { current = false; };
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return;
    let current = true;
    const refresh = async () => {
      try {
        const statuses = await getDesktopTools();
        if (current) setTools(statuses);
      } catch {
        if (current) setToolError('Dependency status is unavailable.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [workspaceRoot]);

  async function refreshLoginPath() {
    setToolPending(true);
    setToolError('');
    setToolMessage('Checking the login-shell PATH.');
    try {
      setTools(await refreshDesktopToolsFromLoginShell());
      setToolMessage('Dependency search refreshed.');
    } catch (cause) {
      setToolError(cause instanceof Error ? cause.message : 'Could not refresh dependency search.');
      setToolMessage('Dependency search needs attention.');
    } finally {
      setToolPending(false);
    }
  }

  async function saveToolPath(name: DesktopToolName) {
    const path = toolPaths[name]?.trim();
    if (!path) return;
    setToolPending(true);
    setToolError('');
    setToolMessage(`Saving ${name} override.`);
    try {
      setTools(await setDesktopToolOverride(name, path));
      setToolPaths((current) => ({ ...current, [name]: '' }));
      setToolMessage(`${name} override saved.`);
    } catch (cause) {
      setToolError(cause instanceof Error ? cause.message : `Could not save ${name} override.`);
      setToolMessage('Dependency override needs attention.');
    } finally {
      setToolPending(false);
    }
  }

  async function resetToolPath(name: DesktopToolName) {
    setToolPending(true);
    setToolError('');
    setToolMessage(`Removing ${name} override.`);
    try {
      setTools(await clearDesktopToolOverride(name));
      setToolPaths((current) => ({ ...current, [name]: '' }));
      setToolMessage(`${name} override removed.`);
    } catch (cause) {
      setToolError(cause instanceof Error ? cause.message : `Could not remove ${name} override.`);
      setToolMessage('Dependency override needs attention.');
    } finally {
      setToolPending(false);
    }
  }

  async function changeAutostart(enabled: boolean) {
    setAutostartPending(true);
    setAutostartError('');
    try {
      setAutostartEnabled(await setDesktopAutostart(enabled));
    } catch (cause) {
      setAutostartError(cause instanceof Error ? cause.message : 'Could not update launch-at-login.');
    } finally {
      setAutostartPending(false);
    }
  }

  async function changeWorkspace() {
    setWorkspacePending(true);
    setWorkspaceError('');
    setWorkspaceStatus('Opening the folder picker.');
    try {
      const selected = await chooseDesktopWorkspace();
      if (selected) {
        setWorkspaceStatus('Workspace selected. Restarting the desktop host.');
        window.location.reload();
        return;
      }
      setWorkspaceStatus('Workspace was not changed.');
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : 'We could not change the workspace. Try again.');
      setWorkspaceStatus('Workspace selection needs attention.');
    } finally {
      setWorkspacePending(false);
    }
  }

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
          <p className="settings-label">Model endpoints</p>
          <p className="settings-hint">
            Chat runs only through DONWI Brain, which keeps provider accounts and keys. Brain endpoints
            live in .local/agent/endpoints.json.
          </p>
        </div>
      </div>
      <BrainManagement />
      {workspaceRoot && desktopHostSupported && (
        <section className="suite-panel" aria-labelledby="desktop-host-title">
          <div className="suite-panel__heading">
            <h3 className="settings-label" id="desktop-host-title">Desktop host</h3>
            <p className="settings-hint">The local workspace host is supervised by the desktop app.</p>
          </div>
          <p className="suite-panel__message" role="status" aria-live="polite">
            {hostStatus ? `Host ${hostStatus.lifecycle}; ${hostStatus.restartCount} restarts${hostStatus.lastExitCode === null ? '' : `; last exit ${hostStatus.lastExitCode}`}.` : 'Checking local host status.'}
          </p>
        </section>
      )}
      {workspaceRoot && desktopHostSupported && (
        <section className="suite-panel" aria-labelledby="tool-locator-title">
          <div className="suite-panel__heading">
            <h3 className="settings-label" id="tool-locator-title">Required tools</h3>
            <p className="settings-hint">DONWI Desk needs ws, brain, ripgrep, and git. Overrides are stored separately from endpoint credentials.</p>
          </div>
          <button type="button" disabled={toolPending} onClick={() => void refreshLoginPath()}>
            Search login-shell PATH
          </button>
          <ul className="suite-component-list">
            {REQUIRED_TOOLS.map((name) => {
              const status = tools.find((candidate) => candidate.name === name);
              return (
                <li className="suite-component" key={name}>
                  <div className="suite-component__details">
                    <span className="suite-component__name">{name}</span>
                    <span className="suite-component__status" data-state={status?.available ? 'ready' : 'missing'}>
                      {status?.available ? `Available · ${status.source}` : 'Not found'}
                    </span>
                    {status?.path && <code className="suite-component__version">{status.path}</code>}
                  </div>
                  <div className="suite-component__actions">
                    <label className="visually-hidden" htmlFor={`tool-path-${name}`}>{name} executable override</label>
                    <input
                      id={`tool-path-${name}`}
                      type="text"
                      value={toolPaths[name] ?? ''}
                      placeholder={status?.path ?? 'Absolute executable path'}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setToolPaths((current) => ({ ...current, [name]: event.target.value }))}
                    />
                    <button className="btn" type="button" disabled={toolPending || !toolPaths[name]?.trim()} onClick={() => void saveToolPath(name)}>Save</button>
                    {status?.overridden && <button className="btn" type="button" disabled={toolPending} onClick={() => void resetToolPath(name)}>Reset</button>}
                  </div>
                </li>
              );
            })}
          </ul>
          {toolMessage && <p className="suite-panel__message" role="status" aria-live="polite">{toolMessage}</p>}
          {toolError && <p className="suite-panel__error" role="alert">{toolError}</p>}
        </section>
      )}
      {workspaceRoot && autostartSupported && (
        <section className="suite-panel" aria-labelledby="autostart-title">
          <div className="suite-panel__heading">
            <h3 className="settings-label" id="autostart-title">Launch at login</h3>
            <p className="settings-hint">Optional. Off by default; enable only if you want DONWI Desk to start when you sign in.</p>
          </div>
          <label className="suite-autostart-toggle">
            <input
              type="checkbox"
              checked={autostartEnabled ?? false}
              disabled={autostartPending || autostartEnabled === null}
              onChange={(event) => void changeAutostart(event.target.checked)}
            />
            <span>{autostartEnabled ? 'Enabled' : autostartEnabled === null ? 'Checking...' : 'Disabled'}</span>
          </label>
          {autostartError && <p className="suite-panel__error" role="alert">{autostartError}</p>}
        </section>
      )}
      <section className="suite-panel" aria-labelledby="suite-panel-title">
        <div className="suite-panel__heading">
          <h3 className="settings-label" id="suite-panel-title">DONWI Agent Suite</h3>
          <p className="settings-hint">Readiness only; components remain independently managed.</p>
        </div>
        {suiteError && <p className="suite-panel__message" role="status">{suiteError}</p>}
        {!suite && !suiteError && <p className="suite-panel__message" role="status">Checking local component configuration.</p>}
        {suite && (
          <ul className="suite-component-list" aria-label="Suite component readiness">
            {suite.components.map((component) => (
              <li className="suite-component" key={component.id}>
                <div className="suite-component__copy">
                  <p className="suite-component__name">{component.name}</p>
                  <p className="suite-component__role">{component.role} · {component.distribution}</p>
                  <p className="suite-component__detail">{component.detail}</p>
                  <p className="suite-component__requirement">Needed for {component.requiredFor}</p>
                </div>
                <span className="suite-component__state" data-state={component.state}>
                  {SUITE_STATE_LABEL[component.state]}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="settings-hint">Workspace data, Brain credentials, skill sources, and security policies stay with their owning components.</p>
      </section>
      {workspaceRoot && (
        <div className="settings-row workspace-setting">
          <div className="workspace-setting__copy">
            <p className="settings-label">Active workspace</p>
            <code className="workspace-setting__path">{workspaceRoot}</code>
            <p className="settings-hint">Changing it restarts the local host after the new workspace is validated.</p>
            {workspaceStatus && <p className="settings-hint" role="status" aria-live="polite">{workspaceStatus}</p>}
            {workspaceError && <p className="workspace-setting__error" role="alert">{workspaceError}</p>}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void changeWorkspace()}
            disabled={workspacePending}
            aria-busy={workspacePending}
          >
            {workspacePending ? 'Selecting…' : 'Change'}
          </button>
        </div>
      )}
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
