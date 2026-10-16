import { useCallback, useMemo, useState } from 'react';
import { FloorView, zoneLabel } from './floor/FloorView';
import { MenuDrawer, rooms, type MenuSection } from './drawers/MenuDrawer';
import { AssistantDrawer } from './drawers/AssistantDrawer';
import { AssistantIcon, MenuIcon } from './icons';
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
  const { floor, error } = useFloor();
  const [focusClient, setFocusClient] = useState<string | null>(null);
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

  const openRoom = useCallback((room: FloorRoom) => {
    setProject(room.key);
    setDrawer({ kind: 'menu', section: 'context' });
  }, [setProject]);

  const close = useCallback(() => setDrawer(null), []);

  // The drawer keeps the agent it was opened with, but shows its live pose.
  const agent = drawer?.kind === 'assistant' && drawer.agent
    ? findAgent(floor, drawer.agent.id) ?? drawer.agent
    : null;
  const projectKeys = useMemo(() => rooms(floor).map((room) => room.key), [floor]);
  const waiting = floor?.totals.waiting ?? 0;

  return (
    <div className="desk">
      <header className="desk-bar">
        <div className="desk-crumbs">
          <span className="desk-mark" aria-hidden="true" />
          {focusClient ? (
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
        {floor ? (
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
          onScope={(scope) => setDrawer({ kind: 'assistant', scope, agent: null })}
          onClose={close}
        />
      )}
      <SettingsDialog open={showEndpoints} onClose={() => setShowEndpoints(false)} onSaved={() => undefined} />
    </div>
  );
}
