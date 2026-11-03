import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AgentFigure } from './AgentFigure';
import { LevelScene } from './LevelScene';
import { levelOrder, levelPages, moveFor, pageOf, searchProjects, storeyLevels } from './levels';
import { MAX_SEATS, TABLES_PER_PAGE, levelPlan } from './voxel-level';
import { STATE_LABELS, UNREGISTERED_ZONE, type Floor, type FloorAgent, type FloorRoom } from '../types';
import { BackIcon, CloseIcon, DownIcon, ForwardIcon, SearchIcon, UpIcon } from '../icons';

interface Props {
  floor: Floor;
  navbarTarget: HTMLElement | null;
  /** The level in view, or null for the home level. */
  focusClient: string | null;
  /** The level the floor opens on when none is in view. */
  home: string | null;
  /** The page of tables each level shows, by client. */
  pages: Readonly<Record<string, number>>;
  selectedAgentId: string | null;
  /** A move to a level, at a page of its tables. */
  onMove: (client: string, page: number) => void;
  onAgent: (agent: FloorAgent) => void;
  onRoom: (room: FloorRoom) => void;
}

type Enter = 'up' | 'down' | 'left' | 'right';

const QUIET = new Set(['idle', 'offline']);
/** How long a project found by search or jump stays highlighted. */
const HIGHLIGHT_MS = 2400;

export function zoneLabel(client: string): string {
  return client === UNREGISTERED_ZONE ? 'unregistered' : client;
}

export function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return 'no recorded activity';
  try {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 'no recorded activity';
    const ageHours = Math.floor((Date.now() - ms) / 3600000);
    if (ageHours < 1) return 'just now';
    if (ageHours < 24) return `${ageHours}h ago`;
    const ageDays = Math.floor(ageHours / 24);
    return `${ageDays}d ago (${iso.slice(0, 10)})`;
  } catch {
    return 'unknown';
  }
}

/** A key press meant for a control, a text field, or an open drawer, not for walking the floor. */
function ownedElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], summary')) return true;
  return document.querySelector('[role="dialog"]') !== null;
}

/**
 * The floor as a building, one client per screen: up and down walk the levels, left and right
 * the pages of a level's project tables, active projects first. Each project is a table its
 * agents sit at, posed by their recorded state.
 */
export function FloorView({ floor, navbarTarget, focusClient, home, pages, selectedAgentId, onMove, onAgent, onRoom }: Props) {
  const [studio, setStudio] = useState(true);
  const [search, setSearch] = useState('');
  const [enter, setEnter] = useState<Enter | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const order = useMemo(() => levelOrder(floor.zones), [floor]);
  const levels = useMemo(() => storeyLevels(order), [order]);
  const zones = useMemo(() => new Map(floor.zones.map((zone) => [zone.client, zone])), [floor]);
  const allRooms = useMemo(() => floor.zones.flatMap((zone) => zone.rooms), [floor]);
  const attentionRooms = allRooms.filter((room) => room.pendingApprovals > 0
    || room.agents.some((agent) => agent.state === 'waiting' || agent.state === 'warning'));
  const matches = useMemo(() => searchProjects(floor.zones, search), [floor, search]);

  const wanted = focusClient ?? home;
  const levelIndex = Math.max(0, order.indexOf(wanted ?? ''));
  const client = order[levelIndex];
  const zone = client === undefined ? undefined : zones.get(client);
  const level = client === undefined ? 0 : levels.get(client) ?? 0;
  const levelPagesList = useMemo(() => levelPages(zone?.rooms ?? [], TABLES_PER_PAGE), [zone]);
  const pageIndex = Math.min(pages[client ?? ''] ?? 0, levelPagesList.length - 1);
  const page = levelPagesList[pageIndex]!;
  const plan = levelPlan(level);

  const goLevel = (index: number) => {
    const next = order[index];
    if (next === undefined || index === levelIndex) return;
    setEnter(index < levelIndex ? 'up' : 'down');
    onMove(next, pages[next] ?? 0);
  };
  const goPage = (index: number) => {
    if (client === undefined || index < 0 || index >= levelPagesList.length || index === pageIndex) return;
    setEnter(index < pageIndex ? 'left' : 'right');
    onMove(client, index);
  };
  const jumpTo = (target: string, key: string) => {
    const rooms = zones.get(target)?.rooms ?? [];
    setEnter(null);
    onMove(target, pageOf(rooms, key, TABLES_PER_PAGE));
    setHighlight(key);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ownedElsewhere(event)) return;
      const move = moveFor(event.key);
      if (!move) return;
      event.preventDefault();
      if (move.axis === 'level') goLevel(levelIndex + move.step);
      else goPage(pageIndex + move.step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!highlight) return undefined;
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  if (allRooms.length === 0 || client === undefined || !zone) {
    return (
      <div className="floor floor-empty" role="region" aria-label="Workspace floor">
        <p>No projects are registered yet. Add one with <code>ws new</code>.</p>
      </div>
    );
  }

  const agents = zone.rooms.reduce((n, room) => n + room.agents.length, 0);
  const activeRooms = levelPagesList.filter((entry) => entry.active).reduce((n, entry) => n + entry.rooms.length, 0);
  const headingId = `level-${level}`;
  const table = (room: FloorRoom, index: number) => (
    <Table
      key={room.key}
      room={room}
      plate={studio ? plan.tables[index]?.plate : undefined}
      highlighted={highlight === room.key}
      selectedAgentId={selectedAgentId}
      onAgent={onAgent}
      onRoom={onRoom}
    />
  );

  return (
    <div className={`floor-container${studio ? ' studio-mode' : ''}`}>
      {navbarTarget && createPortal(
      <div className="studio-world-hud desk-floor-hud">
        <h1>Workspace map</h1>
        <dl className="studio-world-status" aria-label="Workspace agent activity">
          <div className="studio-world-stat">
            <dt>Active</dt>
            <dd>{floor.totals.active}</dd>
          </div>
          <div className={`studio-world-stat${floor.totals.waiting > 0 ? ' is-attention' : ''}`}>
            <dt>Waiting</dt>
            <dd>{floor.totals.waiting}</dd>
          </div>
          <div className="studio-world-stat">
            <dt>Agents</dt>
            <dd>{floor.totals.agents}</dd>
          </div>
        </dl>
        <div className="studio-world-actions">
          {attentionRooms.length > 0 && (
            <details className="studio-attention">
              <summary>Attention · {attentionRooms.length} {attentionRooms.length === 1 ? 'project' : 'projects'}</summary>
              <div className="studio-attention-list" role="region" aria-label="Projects needing attention">
                {attentionRooms.map((room) => (
                  <button type="button" key={room.key} onClick={() => onRoom(room)}>
                    <strong>{room.key}</strong>
                    <span>{room.pendingApprovals > 0 ? `${room.pendingApprovals} pending approvals` : 'Agent needs attention'}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          <details className="floor-explore">
            <summary>Explore map</summary>
            <div className="floor-explore-panel">
              <div className="floor-search-box">
                <span className="floor-search-icon" aria-hidden="true"><SearchIcon size={16} /></span>
                <input
                  type="search"
                  className="floor-search-input"
                  placeholder="Search projects, clients, agents..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search projects"
                />
                {search && (
                  <button type="button" className="floor-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                    <CloseIcon />
                  </button>
                )}
              </div>
              {search.trim() && (
                matches.length > 0 ? (
                  <ul className="floor-results" aria-label="Matching projects">
                    {matches.map((match) => (
                      <li key={match.room.key}>
                        <button type="button" onClick={() => jumpTo(match.client, match.room.key)}>
                          <strong>{match.room.key}</strong>
                          <span>L{levels.get(match.client)} · {zoneLabel(match.client)}{match.room.idle ? ' · inactive' : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="floor-results-empty">No project matches.</p>
                )
              )}
              <div className="studio-view-controls">
                <button type="button" className="studio-toggle" aria-pressed={studio} onClick={() => setStudio(!studio)}>
                  {studio ? 'Switch to compact view' : 'Switch to studio view'}
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>, navbarTarget)}

      <section
        className={`level level-${plan.layout} level-theme-${plan.theme}`}
        aria-labelledby={headingId}
        data-level={level}
      >
        <header className="level-head">
          <span className="storey-level" aria-hidden="true">L{level}</span>
          <h2 id={headingId} className="level-title">{zoneLabel(client)}</h2>
          <span className="level-meta">
            {zone.rooms.length} {zone.rooms.length === 1 ? 'project' : 'projects'} · {activeRooms} active
            {agents > 0 && ` · ${agents} ${agents === 1 ? 'agent' : 'agents'}`}
          </span>
          <nav className="level-nav" aria-label="Levels">
            <button type="button" className="level-nav-btn" aria-label="Level up" disabled={levelIndex === 0} onClick={() => goLevel(levelIndex - 1)}>
              <UpIcon />
            </button>
            <select
              className="level-select"
              aria-label="Go to level"
              value={client}
              onChange={(event) => goLevel(order.indexOf(event.target.value))}
            >
              {order.map((entry) => {
                const rooms = zones.get(entry)?.rooms ?? [];
                const busy = rooms.reduce((n, room) => n + room.agents.length, 0);
                return (
                  <option key={entry} value={entry}>
                    L{levels.get(entry)} · {zoneLabel(entry)} ({rooms.length} {rooms.length === 1 ? 'project' : 'projects'}{busy ? `, ${busy} ${busy === 1 ? 'agent' : 'agents'}` : ''})
                  </option>
                );
              })}
            </select>
            <button type="button" className="level-nav-btn" aria-label="Level down" disabled={levelIndex === order.length - 1} onClick={() => goLevel(levelIndex + 1)}>
              <DownIcon />
            </button>
          </nav>
        </header>

        <div className="level-body">
          <button type="button" className="page-arrow page-prev" aria-label="Previous projects" disabled={pageIndex === 0} onClick={() => goPage(pageIndex - 1)}>
            <BackIcon />
          </button>
          <div className="level-viewport">
            {studio ? (
              <div
                key={`${client}:${pageIndex}`}
                className="level-stage"
                data-enter={enter ?? undefined}
                style={{ '--level-ratio': `${plan.view.width} / ${plan.view.height}` } as CSSProperties}
              >
                <LevelScene plan={plan} rooms={page.rooms} />
                <div className="level-tables">{page.rooms.map(table)}</div>
                {page.rooms.length === 0 && <p className="level-empty">No projects on this level.</p>}
              </div>
            ) : (
              <div key={`${client}:${pageIndex}`} className="level-cards" data-enter={enter ?? undefined}>
                {page.rooms.map(table)}
              </div>
            )}
          </div>
          <button
            type="button"
            className="page-arrow page-next"
            aria-label="Next projects"
            disabled={pageIndex === levelPagesList.length - 1}
            onClick={() => goPage(pageIndex + 1)}
          >
            <ForwardIcon />
          </button>
        </div>

        <footer className="level-pages" aria-label="Project pages">
          <span className="level-page-label" aria-live="polite">
            {page.active ? 'Active projects' : 'Inactive projects'} · page {pageIndex + 1} of {levelPagesList.length}
          </span>
          <span className="level-page-dots">
            {levelPagesList.map((entry, index) => (
              <button
                type="button"
                key={index}
                className={`level-page-dot${entry.active ? ' is-active-page' : ''}`}
                aria-label={`Page ${index + 1} of ${levelPagesList.length}, ${entry.active ? 'active' : 'inactive'} projects`}
                aria-current={index === pageIndex ? 'page' : undefined}
                onClick={() => goPage(index)}
              />
            ))}
          </span>
        </footer>
      </section>
    </div>
  );
}

/** A project's table plate: its name, then a control for each agent at the table. */
function Table({ room, plate, highlighted, selectedAgentId, onAgent, onRoom }: {
  room: FloorRoom;
  plate?: { left: number; top: number };
  highlighted: boolean;
  selectedAgentId: string | null;
  onAgent: (agent: FloorAgent) => void;
  onRoom: (room: FloorRoom) => void;
}) {
  const busy = room.agents.some((agent) => !QUIET.has(agent.state));
  const waiting = room.agents.some((agent) => agent.state === 'waiting');
  const warning = !waiting && room.agents.some((agent) => agent.state === 'warning');
  const classes = [
    'room',
    room.agents.length ? '' : 'is-empty',
    busy ? 'is-busy' : '',
    waiting ? 'is-waiting' : '',
    warning ? 'is-warning' : '',
    room.idle ? 'is-idle' : '',
    highlighted ? 'is-highlighted' : '',
  ].filter(Boolean).join(' ');
  const title = [room.description || room.key, `Last active: ${formatLastActive(room.lastActiveAt)}`].join(' · ');
  const position = plate && ({ '--plate-left': `${plate.left}%`, '--plate-top': `${plate.top}%` } as CSSProperties);

  return (
    <article className={classes} aria-label={`Project ${room.key}`} data-project={room.key} style={position || undefined}>
      <header className="room-door">
        <button type="button" className="room-name" onClick={() => onRoom(room)} title={title}>
          {room.key}
        </button>
        {room.group !== '-' && <span className="room-tag">{room.group}</span>}
        {room.codingSession && <span className="room-tag room-tag-session">session</span>}
        {room.idle && <span className="room-tag room-tag-idle">idle</span>}
      </header>
      {room.agents.length > 0 ? (
        <div className="room-desks">
          {room.agents.map((agent, index) => (
            <Seat
              key={agent.id}
              agent={agent}
              seated={index < MAX_SEATS}
              selected={agent.id === selectedAgentId}
              onClick={() => onAgent(agent)}
            />
          ))}
          {room.agents.length > MAX_SEATS && (
            <button
              type="button"
              className="seat-more"
              aria-label={`${room.agents.length - MAX_SEATS} more ${room.agents.length - MAX_SEATS === 1 ? 'agent' : 'agents'} in ${room.key}`}
              onClick={() => onRoom(room)}
            >
              +{room.agents.length - MAX_SEATS}
            </button>
          )}
        </div>
      ) : (
        <div className="room-vacant" aria-hidden="true">
          <span className="vacant-desk" />
        </div>
      )}
    </article>
  );
}

function Seat({ agent, seated, selected, onClick }: {
  agent: FloorAgent;
  seated: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const label = STATE_LABELS[agent.state];
  const detail = agent.detail ? `, ${agent.detail}` : '';
  return (
    <button
      type="button"
      className={`seat seat-${agent.state}${seated ? ' is-seated' : ''}`}
      data-agent-id={agent.id}
      aria-pressed={selected}
      aria-label={`${agent.tool} in ${agent.project}: ${label}${detail}`}
      title={agent.detail || undefined}
      onClick={onClick}
    >
      {/* Keyed by state: a new pose mounts fresh and plays its entrance. */}
      <AgentFigure key={agent.state} state={agent.state} tool={agent.tool} size={56} />
      <span className="seat-name">{agent.tool}</span>
      <span className="seat-state">{label}</span>
    </button>
  );
}
