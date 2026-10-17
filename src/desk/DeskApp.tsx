import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FloorView, zoneLabel } from './floor/FloorView';
import { ProjectRoom } from './room/ProjectRoom';
import { MenuDrawer, rooms, type MenuSection } from './drawers/MenuDrawer';
import { AssistantDrawer } from './drawers/AssistantDrawer';
import { AssistantIcon, MenuIcon, MoonIcon, SunIcon } from './icons';
import { useFloor } from './useFloor';
import { useTheme } from './useTheme';
import { useScopedChat } from './useScopedChat';
import { SettingsDialog } from '../components/settings/SettingsDialog';
import type { Floor, FloorAgent, FloorRoom } from './types';
import './desk.css';

type DrawerState =
  | { kind: 'menu'; section: MenuSection | null }
  | { kind: 'assistant'; scope: string; agent: FloorAgent | null }
  | null;

const PROJECT_KEY = 'desk-project';

function storedProject(): string {
  try { return localStorage.getItem(PROJECT_KEY) ?? ''; } catch { return ''; }
}

function findAgent(floor: Floor | null, id: string): FloorAgent | undefined {
  return floor?.zones.flatMap((z) => z.rooms.flatMap((r) => r.agents)).find((a) => a.id === id);
}

/**
 * The desk: the floor fills the screen; the only chrome is the assistant and menu icons
 * at the top right. See docs/desk/README.md and docs/desk/wireframe.md.
 */
export function DeskApp() {
  const { theme, setTheme, dark } = useTheme();
  const { floor, error, live } = useFloor();
  const [focusClient, setFocusClient] = useState<string | null>(null);
  /** The project whose room fills the main area, or null for the floor. */
  const [room, setRoom] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [project, setProjectState] = useState(storedProject);
  const [showEndpoints, setShowEndpoints] = useState(false);

  const assistantScope = drawer?.kind === 'assistant' ? drawer.scope : '';
  const chat = useScopedChat(assistantScope);

  const setProject = useCallback((key: string) => {
    setProjectState(key);
    try { localStorage.setItem(PROJECT_KEY, key); } catch { /* the choice lasts this page */ }
  }, []);

  const openAgent = useCallback((agent: FloorAgent) => {
    setProject(agent.project);
    setDrawer({ kind: 'assistant', scope: agent.project, agent });
  }, [setProject]);

  const openRoom = useCallback((target: FloorRoom) => {
    setProject(target.key);
    setRoom(target.key);
  }, [setProject]);

  // Escape leaves a room for the floor, unless a drawer is open: then it closes the drawer.
  useEffect(() => {
    if (!room) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !drawer) setRoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, drawer]);

  const close = useCallback(() => setDrawer(null), []);

  // The drawer keeps the agent it was opened with, but shows its live pose.
  const agent = drawer?.kind === 'assistant' && drawer.agent
    ? findAgent(floor, drawer.agent.id) ?? drawer.agent
    : null;
  const projectKeys = useMemo(() => rooms(floor).map((r) => r.key), [floor]);
  const roomClient = floor?.zones.find((z) => z.rooms.some((r) => r.key === room))?.client ?? '-';
  // The room reloads when its own corner of the floor moves, not when another project's does.
  const roomVersion = useMemo(() => {
    const entry = floor?.zones.flatMap((z) => z.rooms).find((r) => r.key === room);
    return entry ? JSON.stringify(entry) : '';
  }, [floor, room]);
  const waiting = floor?.totals.waiting ?? 0;

  // Track previous waiting count to alert when new agents need attention / approval.
  const prevWaiting = useRef<number | null>(null);
  useEffect(() => {
    const base = 'desk';
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (prevWaiting.current !== null && waiting > prevWaiting.current) {
        const delta = waiting - prevWaiting.current;
        if (Notification.permission === 'granted') {
          try {
            const notif = new Notification('Agent approval needed', {
              body: `${delta} agent${delta === 1 ? '' : 's'} raised a hand and need${delta === 1 ? 's' : ''} your approval on desk.`,
            });
            notif.onclick = () => window.focus();
          } catch {
            // Notification dispatch may fail in non-secure or restricted contexts
          }
        }
      } else if (prevWaiting.current === null && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => undefined);
      }
    }
    prevWaiting.current = waiting;
  }, [waiting]);

  return (
    <div className="desk">
      <header className="desk-bar">
        <div className="desk-crumbs">
          <span className="desk-mark" aria-hidden="true" />
          {room ? (
            <nav aria-label="Floor position" className="crumbs">
              <button type="button" onClick={() => { setRoom(null); setFocusClient(null); }}>All</button>
              <span aria-hidden="true">/</span>
              <button type="button" onClick={() => { setRoom(null); setFocusClient(roomClient); }}>{zoneLabel(roomClient)}</button>
              <span aria-hidden="true">/</span>
              <span aria-current="location">{room}</span>
            </nav>
          ) : focusClient ? (
            <nav aria-label="Floor position" className="crumbs">
              <button type="button" onClick={() => setFocusClient(null)}>All</button>
              <span aria-hidden="true">/</span>
              <span aria-current="location">{zoneLabel(focusClient)}</span>
            </nav>
          ) : (
            <span className="desk-name">desk</span>
          )}
        </div>
        <div className="desk-actions">
          <button
            type="button"
            className="bar-btn"
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            className="bar-btn"
            aria-label="Assistant"
            aria-expanded={drawer?.kind === 'assistant'}
            onClick={() => setDrawer(drawer?.kind === 'assistant' ? null : { kind: 'assistant', scope: '', agent: null })}
          >
            <AssistantIcon />
          </button>
          <button
            type="button"
            className="bar-btn"
            aria-label={waiting ? `Menu, ${waiting} waiting for you` : 'Menu'}
            aria-expanded={drawer?.kind === 'menu'}
            onClick={() => setDrawer(drawer?.kind === 'menu' ? null : { kind: 'menu', section: null })}
          >
            <MenuIcon />
            {waiting > 0 && <span className="bar-dot" aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="desk-main">
        {room ? (
          <ProjectRoom
            project={room}
            version={roomVersion}
            onAgent={openAgent}
            onAssistant={(key) => setDrawer({ kind: 'assistant', scope: key, agent: null })}
            onNotes={(key) => { setProject(key); setDrawer({ kind: 'menu', section: 'notes' }); }}
          />
        ) : floor ? (
          <FloorView
            floor={floor}
            focusClient={focusClient}
            selectedAgentId={agent?.id ?? null}
            onFocusClient={setFocusClient}
            onAgent={openAgent}
            onRoom={openRoom}
          />
        ) : (
          <p className="desk-loading" role="status">{error ? `[ERROR] ${error}` : 'Loading the floor...'}</p>
        )}
      </main>

      {floor && (
        <footer className="desk-caption" role="status">
          <span className={`live-dot${live ? ' is-live' : ''}`} aria-hidden="true" />
          <span className="visually-hidden">{live ? 'Live. ' : 'Reconnecting. '}</span>
          {floor.totals.agents} {floor.totals.agents === 1 ? 'agent' : 'agents'}
          {floor.totals.active > 0 && ` · ${floor.totals.active} active`}
          {waiting > 0 && <strong className="caption-attn"> · {waiting} waiting for you</strong>}
          {error && <span className="caption-error"> · [WARN] floor not updated: {error}</span>}
        </footer>
      )}

      {drawer?.kind === 'menu' && (
        <MenuDrawer
          floor={floor}
          project={project}
          section={drawer.section}
          dark={dark}
          theme={theme}
          onProject={setProject}
          onSection={(section) => setDrawer({ kind: 'menu', section })}
          onFloor={() => { setFocusClient(null); close(); }}
          onTheme={setTheme}
          onEndpoints={() => setShowEndpoints(true)}
          onClose={close}
        />
      )}
      {drawer?.kind === 'assistant' && (
        <AssistantDrawer
          scope={drawer.scope}
          agent={agent}
          projectKeys={projectKeys}
          chat={chat}
          dark={dark}
          onTheme={(t) => setTheme(t)}
          onScope={(scope) => setDrawer({ kind: 'assistant', scope, agent: null })}
          onClose={close}
        />
      )}
      <SettingsDialog open={showEndpoints} onClose={() => setShowEndpoints(false)} onSaved={() => undefined} />
    </div>
  );
}
