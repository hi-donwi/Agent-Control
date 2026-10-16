import { AgentFigure } from './AgentFigure';
import { STATE_LABELS, UNREGISTERED_ZONE, type Floor, type FloorAgent, type FloorRoom, type FloorZone } from '../types';

interface Props {
  floor: Floor;
  focusClient: string | null;
  selectedAgentId: string | null;
  onFocusClient: (client: string | null) => void;
  onAgent: (agent: FloorAgent) => void;
  onRoom: (room: FloorRoom) => void;
}

const QUIET = new Set(['idle', 'offline']);

export function zoneLabel(client: string): string {
  return client === UNREGISTERED_ZONE ? 'unregistered' : client;
}

/** Clients as zones, projects as rooms, agents at their desks. */
export function FloorView({ floor, focusClient, selectedAgentId, onFocusClient, onAgent, onRoom }: Props) {
  const zones = focusClient ? floor.zones.filter((zone) => zone.client === focusClient) : floor.zones;
  if (zones.length === 0) {
    return (
      <div className="floor floor-empty" role="region" aria-label="Workspace floor">
        <p>No projects are registered yet. Add one with <code>ws new</code>.</p>
      </div>
    );
  }
  return (
    <div className={`floor${focusClient ? ' is-focused' : ''}`} role="region" aria-label="Workspace floor">
      {zones.map((zone) => (
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
    <section className={`zone${agents ? '' : ' is-quiet'}`} aria-labelledby={headingId}>
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
  const classes = ['room', room.agents.length ? '' : 'is-empty', busy ? 'is-busy' : '', waiting ? 'is-waiting' : '', warning ? 'is-warning' : '']
    .filter(Boolean).join(' ');
  return (
    <article className={classes} aria-label={`Project ${room.key}`} data-project={room.key}>
      <header className="room-door">
        <button type="button" className="room-name" onClick={() => onRoom(room)} title={room.description || room.key}>
          {room.key}
        </button>
        {room.group !== '-' && <span className="room-tag">{room.group}</span>}
        {room.codingSession && <span className="room-tag room-tag-session">session</span>}
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
      <AgentFigure state={agent.state} tool={agent.tool} size={68} />
      <span className="seat-name">{agent.tool}</span>
      <span className="seat-state">{label}</span>
    </button>
  );
}
