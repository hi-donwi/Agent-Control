import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FloorView, zoneLabel } from './floor/FloorView';
import { ProjectRoom } from './room/ProjectRoom';
import { MenuDrawer, rooms, type MenuSection } from './drawers/MenuDrawer';
import { AssistantDrawer, type AssistantTab } from './drawers/AssistantDrawer';
import { ResponseCompareDrawer } from './drawers/ResponseCompareDrawer';
import { AssistantIcon, MenuIcon, MoonIcon, SunIcon } from './icons';
import { useFloor } from './useFloor';
import { useTheme } from './useTheme';
import { useScopedChat } from './useScopedChat';
import { CommandDock } from './command/CommandDock';
import { resolveChatChoice, type CommandTarget, type NoteDraft, type TaskDraft } from './command/command-state';
import { SettingsDialog } from '../components/settings/SettingsDialog';
import { TodayView } from './pm/TodayView';
import { MissionsView } from './pm/MissionsView';
import { TaskDrawer } from './pm/TaskDrawer';
import { BacklogView } from './pm/BacklogView';
import { TimelineView } from './pm/TimelineView';
import { ClientsView } from './pm/ClientsView';
import { ClientPage } from './pm/ClientPage';
import { usePmAlerts } from './pm/usePm';
import { useProviders } from '../hooks/useProviders';
import { useProjects } from '../hooks/useProjects';
import { DATE_ALERTS, PM_PAGE_TITLE, type PmPage } from './pm/pages';
import type { ChatMessage } from '../lib/types';
import type { Floor, FloorAgent, FloorRoom } from './types';
import './desk.css';
import './floor/studio.css';

type DrawerState =
  | { kind: 'menu'; section: MenuSection | null; noteDraft?: NoteDraft & { id: string }; noteDraftKey?: string }
  | { kind: 'assistant'; scope: string; agent: FloorAgent | null; initialTab?: AssistantTab; focusApprovalId?: string }
  | { kind: 'compare'; scope: string; current: ChatMessage; candidates: ChatMessage[] }
  | null;

const PROJECT_KEY = 'desk-project';

function storedProject(): string {
  try { return localStorage.getItem(PROJECT_KEY) ?? ''; } catch { return ''; }
}

function createLocalDraftId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `note-draft-${Date.now()}`;
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
  /** A project management view filling the main area (Today, ...), or null. */
  const [page, setPage] = useState<PmPage | null>(null);
  /** The client whose dossier fills the main area, opened from Clients or a client scope. */
  const [clientPage, setClientPage] = useState<string | null>(null);
  const pm = usePmAlerts();
  /** The task open in its drawer, and a counter its changes bump so the views follow. */
  const [task, setTask] = useState<{ scope: string; id: string } | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [pmChanges, setPmChanges] = useState(0);
  const openTask = useCallback((scope: string, id: string) => {
    setDrawer(null);
    setTask({ scope, id });
  }, []);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [project, setProjectState] = useState(storedProject);
  const [showEndpoints, setShowEndpoints] = useState(false);
  const [commandScope, setCommandScope] = useState('');
  const [commandAgentId, setCommandAgentId] = useState<string | null>(null);

  const assistantScope = drawer?.kind === 'assistant' ? drawer.scope : commandScope;
  const chat = useScopedChat(assistantScope);
  const { providers, defaultProvider, defaultModel } = useProviders();
  const { projects } = useProjects();
  const commandChoice = useMemo(
    () => resolveChatChoice(providers, projects, assistantScope, defaultProvider, defaultModel),
    [assistantScope, defaultModel, defaultProvider, projects, providers],
  );

  const setProject = useCallback((key: string) => {
    setProjectState(key);
    try { localStorage.setItem(PROJECT_KEY, key); } catch { /* the choice lasts this page */ }
  }, []);

  const openAgent = useCallback((agent: FloorAgent) => {
    setProject(agent.project);
    setCommandScope(agent.project);
    setCommandAgentId(agent.id);
    setDrawer({ kind: 'assistant', scope: agent.project, agent, initialTab: 'chat' });
  }, [setProject]);

  const openRoom = useCallback((target: FloorRoom) => {
    setProject(target.key);
    setCommandScope(target.key);
    setCommandAgentId(null);
    setPage(null);
    setClientPage(null);
    setRoom(target.key);
  }, [setProject]);

  // A task's scope: a project opens its room; a client's own work opens the client's dossier.
  const openScope = useCallback((scope: string) => {
    setPage(null);
    if (scope.startsWith('@')) {
      setRoom(null);
      setClientPage(scope.slice(1));
    } else {
      setClientPage(null);
      setProject(scope);
      setCommandScope(scope);
      setCommandAgentId(null);
      setRoom(scope);
    }
  }, [setProject]);

  const selectCommandTarget = useCallback((target: CommandTarget) => {
    setCommandScope(target.project);
    setCommandAgentId(target.agentId);
    if (target.project) setProject(target.project);
    if (drawer?.kind === 'assistant') {
      setDrawer({
        kind: 'assistant',
        scope: target.project,
        agent: target.agentId ? findAgent(floor, target.agentId) ?? null : null,
        initialTab: 'chat',
      });
    }
  }, [drawer, floor, setProject]);

  const openCommandTarget = useCallback((target: CommandTarget, view: AssistantTab = 'chat') => {
    if (target.kind === 'project-agent' && target.agentId) {
      const agent = findAgent(floor, target.agentId);
      if (agent) {
        setProject(agent.project);
        setCommandScope(agent.project);
        setCommandAgentId(agent.id);
        setDrawer({ kind: 'assistant', scope: agent.project, agent, initialTab: view });
      } else {
        setCommandScope(target.project);
        setCommandAgentId(target.agentId);
        setDrawer({ kind: 'assistant', scope: target.project, agent: null, initialTab: view });
      }
      return;
    }
    if (target.kind === 'control-plane') {
      setCommandScope('');
      setCommandAgentId(null);
      setDrawer({ kind: 'assistant', scope: '', agent: null, initialTab: view });
    }
  }, [floor, setProject]);

  const openCommandReview = useCallback((target: CommandTarget) => {
    openCommandTarget(target, 'changes');
  }, [openCommandTarget]);

  const openResponseComparison = useCallback((target: CommandTarget, current: ChatMessage, candidates: ChatMessage[]) => {
    if (target.kind !== 'project-agent' || !target.project || !target.writable || candidates.length === 0) return;
    setProject(target.project);
    setCommandScope(target.project);
    setCommandAgentId(target.agentId);
    setRoom(null);
    setPage(null);
    setClientPage(null);
    setDrawer({ kind: 'compare', scope: target.project, current, candidates });
  }, [setProject]);

  const openCommandApproval = useCallback((target: CommandTarget, approvalId: string) => {
    if (target.kind !== 'project-agent' || !target.project || !target.writable) return;
    const agent = target.agentId ? findAgent(floor, target.agentId) ?? null : null;
    setProject(target.project);
    setCommandScope(target.project);
    setCommandAgentId(target.agentId);
    setDrawer({ kind: 'assistant', scope: target.project, agent, initialTab: 'chat', focusApprovalId: approvalId });
  }, [floor, setProject]);

  const openPage = useCallback((next: PmPage) => {
    setRoom(null);
    setClientPage(null);
    setPage(next);
    setDrawer(null);
  }, []);

  const openTaskDraft = useCallback((draft: TaskDraft) => {
    setTaskDraft(draft);
    setProject(draft.scope);
    setCommandScope(draft.scope);
    setCommandAgentId(null);
    openPage('backlog');
  }, [openPage, setProject]);
  const consumeTaskDraft = useCallback(() => setTaskDraft(null), []);

  const openNoteDraft = useCallback((draft: NoteDraft) => {
    const id = createLocalDraftId();
    setProject(draft.scope);
    setCommandScope(draft.scope);
    setCommandAgentId(null);
    setRoom(null);
    setPage(null);
    setClientPage(null);
    setDrawer({ kind: 'menu', section: 'notes', noteDraft: { ...draft, id }, noteDraftKey: id });
  }, [setProject]);

  const noteDraftSaved = useCallback(() => {
    setDrawer((current) => current?.kind === 'menu' && current.noteDraft
      ? { ...current, noteDraft: undefined }
      : current);
  }, []);

  // Escape leaves a room or a view for the floor, unless a drawer is open: then it closes the drawer.
  useEffect(() => {
    if (!room && !page && !clientPage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !drawer && !task) { setRoom(null); setPage(null); setClientPage(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, page, clientPage, drawer, task]);

  // The menu or the assistant takes the right-hand side; an open task gives way to it.
  useEffect(() => {
    if (drawer) setTask(null);
  }, [drawer]);

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
  // Late, due, and reminding work the floor does not show; approvals and hands it does.
  const dated = pm.alerts.filter((a) => DATE_ALERTS.has(a.kind)).length;
  const alertsVersion = `${pm.alerts.map((a) => a.id).join(',')}#${pmChanges}`;

  // Track previous waiting count to alert when new agents need attention / approval.
  const prevWaiting = useRef<number | null>(null);
  useEffect(() => {
    const base = 'desk';
    const count = waiting + dated;
    document.title = count > 0 ? `(${count}) ${base}` : base;

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
  }, [waiting, dated]);

  return (
    <div className="desk">
      <header className="desk-bar">
        <div className="desk-crumbs">
          <span className="desk-mark" aria-hidden="true" />
          {clientPage ? (
            <nav aria-label="Floor position" className="crumbs">
              <button type="button" onClick={() => setClientPage(null)}>All</button>
              <span aria-hidden="true">/</span>
              <button type="button" onClick={() => openPage('clients')}>Clients</button>
              <span aria-hidden="true">/</span>
              <span aria-current="location">{clientPage}</span>
            </nav>
          ) : page ? (
            <nav aria-label="Floor position" className="crumbs">
              <button type="button" onClick={() => setPage(null)}>All</button>
              <span aria-hidden="true">/</span>
              <span aria-current="location">{PM_PAGE_TITLE[page]}</span>
            </nav>
          ) : room ? (
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
            onClick={() => {
              if (drawer?.kind === 'assistant') {
                setDrawer(null);
              } else {
                setCommandScope('');
                setCommandAgentId(null);
                setDrawer({ kind: 'assistant', scope: '', agent: null });
              }
            }}
          >
            <AssistantIcon />
          </button>
          <button
            type="button"
            className="bar-btn"
            aria-label={waiting || dated ? `Menu, ${[waiting ? `${waiting} waiting for you` : '', dated ? `${dated} due or late` : ''].filter(Boolean).join(', ')}` : 'Menu'}
            aria-expanded={drawer?.kind === 'menu'}
            onClick={() => setDrawer(drawer?.kind === 'menu' ? null : { kind: 'menu', section: null })}
          >
            <MenuIcon />
            {(waiting > 0 || dated > 0) && <span className="bar-dot" aria-hidden="true" />}
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
        ) : page === 'today' ? (
          <TodayView
            floor={floor}
            version={alertsVersion}
            onOpenScope={openScope}
            onAssistant={(key) => setDrawer({ kind: 'assistant', scope: key, agent: null })}
            onAgent={openAgent}
            onSnooze={pm.snooze}
            onOpenTask={openTask}
          />
        ) : clientPage ? (
          <ClientPage client={clientPage} version={alertsVersion} onOpenProject={(key) => openScope(key)} onOpenTask={openTask} />
        ) : page === 'missions' ? (
          <MissionsView projects={projectKeys} version={alertsVersion} onOpenTask={openTask} />
        ) : page === 'backlog' ? (
          <BacklogView
            projects={projectKeys}
            version={alertsVersion}
            onOpenTask={openTask}
            taskDraft={taskDraft}
            onTaskDraftConsumed={consumeTaskDraft}
          />
        ) : page === 'timeline' ? (
          <TimelineView version={alertsVersion} onOpenTask={openTask} />
        ) : page === 'clients' ? (
          <ClientsView version={alertsVersion} onOpenClient={(key) => { setPage(null); setClientPage(key); }} />
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

      <CommandDock
        floor={floor}
        scope={assistantScope}
        targetAgentId={commandAgentId}
        chat={chat}
        providerReady={Boolean(commandChoice)}
        popoverBehindDrawer={Boolean(drawer || task || showEndpoints)}
        onTargetChange={selectCommandTarget}
        onOpenTarget={openCommandTarget}
        onOpenReview={openCommandReview}
        onOpenTask={openTask}
        onReviewApproval={openCommandApproval}
        onDraftTask={openTaskDraft}
        onDraftNote={openNoteDraft}
        onCompareResponses={openResponseComparison}
        onSend={(message) => {
          if (commandChoice) chat.send(message, commandChoice.provider, commandChoice.model);
        }}
      />

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
          noteDraft={drawer.noteDraft}
          noteDraftKey={drawer.noteDraftKey}
          dark={dark}
          theme={theme}
          onProject={setProject}
          onSection={(section) => setDrawer({ kind: 'menu', section })}
          onFloor={() => { setFocusClient(null); close(); }}
          onTheme={setTheme}
          onEndpoints={() => setShowEndpoints(true)}
          onClose={close}
          alerts={pm.alerts}
          onSnooze={pm.snooze}
          onPage={openPage}
          onOpenScope={openScope}
          onAssistantScope={(key) => setDrawer({ kind: 'assistant', scope: key, agent: null })}
          onOpenTask={openTask}
          onNoteDraftSaved={noteDraftSaved}
        />
      )}
      {task && !drawer && (
        <TaskDrawer
          key={`${task.scope}:${task.id}`}
          scope={task.scope}
          id={task.id}
          onClose={() => setTask(null)}
          onChanged={() => { setPmChanges((n) => n + 1); pm.refresh(); }}
        />
      )}
      {drawer?.kind === 'assistant' && (
        <AssistantDrawer
          scope={drawer.scope}
          agent={agent}
          projectKeys={projectKeys}
          chat={chat}
          dark={dark}
          initialTab={drawer.initialTab}
          focusApprovalId={drawer.focusApprovalId}
          onTheme={(t) => setTheme(t)}
          onScope={(scope) => {
            setCommandScope(scope);
            setCommandAgentId(null);
            setDrawer({ kind: 'assistant', scope, agent: null, initialTab: 'chat' });
          }}
          onClose={close}
        />
      )}
      {drawer?.kind === 'compare' && (
        <ResponseCompareDrawer
          scope={drawer.scope}
          current={drawer.current}
          candidates={drawer.candidates}
          onClose={close}
        />
      )}
      <SettingsDialog open={showEndpoints} onClose={() => setShowEndpoints(false)} onSaved={() => undefined} />
    </div>
  );
}
