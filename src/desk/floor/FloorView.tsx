import { useMemo, useState } from 'react';
import { AgentFigure } from './AgentFigure';
import { STATE_LABELS, UNREGISTERED_ZONE, type Floor, type FloorAgent, type FloorRoom, type FloorZone } from '../types';
import { CloseIcon, SearchIcon } from '../icons';

interface Props {
  floor: Floor;
  focusClient: string | null;
  selectedAgentId: string | null;
  onFocusClient: (client: string | null) => void;
  onAgent: (agent: FloorAgent) => void;
  onRoom: (room: FloorRoom) => void;
}

const QUIET = new Set(['idle', 'offline']);
const LARGE_ZONE_ROOMS = 5;

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

/** Clients as zones, projects as rooms, agents at their desks, with search, client/project navigation, and idle filtering. */
export function FloorView({ floor, focusClient, selectedAgentId, onFocusClient, onAgent, onRoom }: Props) {
  // Default to hiding idle projects (> 1 day inactive).
  const [filterMode, setFilterMode] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const allRooms = useMemo(() => floor.zones.flatMap((z) => z.rooms), [floor]);
  const activeCount = useMemo(() => allRooms.filter((r) => !r.idle).length, [allRooms]);
  const idleCount = allRooms.length - activeCount;

  const clientOptions = useMemo(() => {
    return floor.zones.map((z) => ({
      client: z.client,
      totalRooms: z.rooms.length,
      activeRooms: z.rooms.filter((r) => !r.idle).length,
    }));
  }, [floor]);

  const projectOptions = useMemo(() => {
    const list = focusClient ? floor.zones.find((z) => z.client === focusClient)?.rooms ?? [] : allRooms;
    return [...list].sort((a, b) => a.key.localeCompare(b.key));
  }, [floor, focusClient, allRooms]);

  // Compute filtered zones and rooms
  const { filteredZones, visibleRoomCount, totalZonesCount } = useMemo(() => {
    const q = search.trim().toLowerCase();

    const zones = floor.zones
      .filter((zone) => {
        if (focusClient && zone.client !== focusClient) return false;
        return true;
      })
      .map((zone) => {
        const rooms = zone.rooms.filter((room) => {
          if (selectedProject && room.key !== selectedProject) return false;

          if (q) {
            const matchKey = room.key.toLowerCase().includes(q);
            const matchDesc = room.description?.toLowerCase().includes(q);
            const matchGroup = room.group?.toLowerCase().includes(q);
            const matchClient = zone.client.toLowerCase().includes(q);
            const matchAgent = room.agents.some((a) => a.tool.toLowerCase().includes(q) || a.detail.toLowerCase().includes(q));
            if (!matchKey && !matchDesc && !matchGroup && !matchClient && !matchAgent) {
              return false;
            }
          }

          // In active mode (unless overridden by specific search or project selection):
          if (filterMode === 'active' && !selectedProject && !q) {
            if (room.idle) return false;
          }

          return true;
        });

        return { ...zone, rooms };
      })
      .filter((zone) => zone.rooms.length > 0);

    const count = zones.reduce((n, z) => n + z.rooms.length, 0);
    return { filteredZones: zones, visibleRoomCount: count, totalZonesCount: zones.length };
  }, [floor, focusClient, selectedProject, search, filterMode]);

  const resetFilters = () => {
    setSearch('');
    setSelectedProject(null);
    onFocusClient(null);
    setFilterMode('active');
  };

  const isCustomFiltered = Boolean(search || selectedProject || focusClient || filterMode === 'all');

  if (allRooms.length === 0) {
    return (
      <div className="floor floor-empty" role="region" aria-label="Workspace floor">
        <p>No projects are registered yet. Add one with <code>ws new</code>.</p>
      </div>
    );
  }

  return (
    <div className="floor-container">
      <div className="floor-toolbar" role="toolbar" aria-label="Floor filters and search">
        <div className="floor-search-box">
          <span className="floor-search-icon" aria-hidden="true"><SearchIcon size={16} /></span>
          <input
            type="search"
            className="floor-search-input"
            placeholder="Search projects, clients, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
          {search && (
            <button type="button" className="floor-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="floor-filter-group">
          <div className="floor-segmented" role="radiogroup" aria-label="Activity filter">
            <button
              type="button"
              role="radio"
              aria-checked={filterMode === 'active'}
              className={`segment-btn${filterMode === 'active' ? ' is-active' : ''}`}
              onClick={() => setFilterMode('active')}
              title="Show only projects active within 1 day"
            >
              Active (&le; 1d)
              <span className="segment-count">{activeCount}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={filterMode === 'all'}
              className={`segment-btn${filterMode === 'all' ? ' is-active' : ''}`}
              onClick={() => setFilterMode('all')}
              title="Show all projects including idle ones"
            >
              All
              <span className="segment-count">{allRooms.length}</span>
            </button>
          </div>

          <div className="floor-select-wrap">
            <label htmlFor="floor-client-filter" className="visually-hidden">Filter by client</label>
            <select
              id="floor-client-filter"
              className="floor-select"
              value={focusClient ?? 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? null : e.target.value;
                onFocusClient(val);
                setSelectedProject(null);
              }}
              title="Filter by client"
            >
              <option value="all">All Clients ({clientOptions.length})</option>
              {clientOptions.map((c) => (
                <option key={c.client} value={c.client}>
                  {zoneLabel(c.client)} ({c.activeRooms} active / {c.totalRooms})
                </option>
              ))}
            </select>
          </div>

          <div className="floor-select-wrap">
            <label htmlFor="floor-project-filter" className="visually-hidden">Filter by project</label>
            <select
              id="floor-project-filter"
              className="floor-select"
              value={selectedProject ?? 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? null : e.target.value;
                setSelectedProject(val);
              }}
              title="Filter by project"
            >
              <option value="all">All Projects ({projectOptions.length})</option>
              {projectOptions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} {p.idle ? '(idle)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="floor-status-strip">
        <span className="floor-status-text">
          Showing {visibleRoomCount} {visibleRoomCount === 1 ? 'project' : 'projects'} in {totalZonesCount} {totalZonesCount === 1 ? 'client' : 'clients'}
          {filterMode === 'active' && idleCount > 0 && !search && !selectedProject && (
            <>
              &nbsp;&middot;&nbsp;{idleCount} idle hidden (&gt; 1d)
              <button
                type="button"
                className="floor-status-link"
                onClick={() => setFilterMode('all')}
              >
                show all
              </button>
            </>
          )}
          {filterMode === 'all' && idleCount > 0 && !search && !selectedProject && (
            <>
              &nbsp;&middot;&nbsp;
              <button
                type="button"
                className="floor-status-link"
                onClick={() => setFilterMode('active')}
              >
                hide idle (&gt; 1d)
              </button>
            </>
          )}
        </span>
        {isCustomFiltered && (
          <button type="button" className="floor-btn-reset" onClick={resetFilters}>
            Reset filters
          </button>
        )}
      </div>

      {filteredZones.length === 0 ? (
        <div className="floor-no-results">
          <p>No projects match your filter or search criteria.</p>
          <button type="button" className="floor-btn-reset" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      ) : (
        <div className={`floor${focusClient ? ' is-focused' : ''}`} role="region" aria-label="Workspace floor">
          {filteredZones.map((zone) => (
            <Zone
              key={zone.client}
              zone={zone}
              focused={focusClient === zone.client}
              selectedAgentId={selectedAgentId}
              onFocus={() => onFocusClient(focusClient === zone.client ? null : zone.client)}
              onAgent={onAgent}
              onRoom={onRoom}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Zone({ zone, focused, selectedAgentId, onFocus, onAgent, onRoom }: {
  zone: FloorZone;
  focused: boolean;
  selectedAgentId: string | null;
  onFocus: () => void;
  onAgent: (agent: FloorAgent) => void;
  onRoom: (room: FloorRoom) => void;
}) {
  const agents = zone.rooms.reduce((n, room) => n + room.agents.length, 0);
  const headingId = `zone-${zone.client}`;
  return (
    <section
      className={`zone${agents ? '' : ' is-quiet'}${zone.rooms.length >= LARGE_ZONE_ROOMS ? ' is-large' : ''}`}
      aria-labelledby={headingId}
    >
      <header className="zone-head">
        <h2 id={headingId} className="zone-title">
          <button type="button" className="zone-name" onClick={onFocus} aria-pressed={focused}>
            {zoneLabel(zone.client)}
          </button>
        </h2>
        <span className="zone-meta">
          {zone.rooms.length} {zone.rooms.length === 1 ? 'project' : 'projects'}
          {agents > 0 && ` · ${agents} ${agents === 1 ? 'agent' : 'agents'}`}
        </span>
      </header>
      <div className="zone-rooms">
        {zone.rooms.map((room) => (
          <Room key={room.key} room={room} selectedAgentId={selectedAgentId} onAgent={onAgent} onRoom={onRoom} />
        ))}
      </div>
    </section>
  );
}

function Room({ room, selectedAgentId, onAgent, onRoom }: {
  room: FloorRoom;
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
  ].filter(Boolean).join(' ');

  const lastActiveText = formatLastActive(room.lastActiveAt);
  const title = [room.description || room.key, `Last active: ${lastActiveText}`].filter(Boolean).join(' · ');

  return (
    <article className={classes} aria-label={`Project ${room.key}`} data-project={room.key}>
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
          {room.agents.map((agent) => (
            <Seat key={agent.id} agent={agent} selected={agent.id === selectedAgentId} onClick={() => onAgent(agent)} />
          ))}
        </div>
      ) : (
        <div className="room-vacant" aria-hidden="true">
          <span className="vacant-desk" />
        </div>
      )}
    </article>
  );
}

function Seat({ agent, selected, onClick }: { agent: FloorAgent; selected: boolean; onClick: () => void }) {
  const label = STATE_LABELS[agent.state];
  const detail = agent.detail ? `, ${agent.detail}` : '';
  return (
    <button
      type="button"
      className={`seat seat-${agent.state}`}
      aria-pressed={selected}
      aria-label={`${agent.tool} in ${agent.project}: ${label}${detail}`}
      title={agent.detail || undefined}
      onClick={onClick}
    >
      {/* Keyed by state: a new pose mounts fresh and plays its entrance. */}
      <AgentFigure key={agent.state} state={agent.state} tool={agent.tool} size={68} />
      <span className="seat-name">{agent.tool}</span>
      <span className="seat-state">{label}</span>
    </button>
  );
}
