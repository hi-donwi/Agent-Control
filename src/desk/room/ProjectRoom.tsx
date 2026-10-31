import { lazy, Suspense, useState } from 'react';
import { AgentFigure } from '../floor/AgentFigure';
import { HandGlyph } from './glyphs';
import { MissionBoard } from './MissionBoard';
import { useProject } from './useProject';
import { useCodingSession } from '../../hooks/useCodingSession';
import { STATE_LABELS, type FloorAgent, type ProjectDetail } from '../types';
import { ago } from '../time';

const ProjectContextAtlas = lazy(() => import('./ProjectContextAtlas'));

interface Props {
  project: string;
  /** Changes whenever this project's room on the floor does, so the room follows its agents and approvals live. */
  version: string;
  onAgent: (agent: FloorAgent) => void;
  onAssistant: (project: string) => void;
  onNotes: (project: string) => void;
}

interface Blocker {
  kind: 'approval' | 'task' | 'step' | 'memory';
  text: string;
  detail: string;
}

/** Everything that waits on something or someone, from every source the room reads. */
function blockers(detail: ProjectDetail): Blocker[] {
  return [
    ...detail.approvals.map((a) => ({ kind: 'approval' as const, text: `Approval: ${a.action}`, detail: `requested ${ago(a.requestedAt)} ago` })),
    ...detail.tasks.filter((t) => t.blocked === 'yes').map((t) => ({ kind: 'task' as const, text: t.title, detail: t.blockedReason })),
    ...detail.plans.filter((p) => p.status === 'blocked').map((p) => ({ kind: 'step' as const, text: p.task, detail: p.notes || p.run })),
    ...detail.memory.blockedOn.map((b) => ({ kind: 'memory' as const, text: b.item, detail: [b.waitingFor, b.since].filter(Boolean).join(' · ') })),
  ];
}

const KIND_LABEL: Record<Blocker['kind'], string> = { approval: 'needs you', task: 'task', step: 'run step', memory: 'memory' };

/**
 * One project as a room: what it is and where it stands, the work moving through it, who
 * is in it, what holds it up, what it remembers, and what an agent bound to it may load
 * and reach. Reads one endpoint; every change goes through `ws`.
 */
export function ProjectRoom({ project, version, onAgent, onAssistant, onNotes }: Props) {
  const { detail, error, reload } = useProject(project, version);
  const coding = useCodingSession(project);
  const [roomView, setRoomView] = useState<'room' | 'context'>('room');
  if (error && !detail) return <p className="desk-loading" role="alert">[ERROR] {error}</p>;
  if (!detail) return <p className="desk-loading" role="status">Opening {project}...</p>;

  const holds = blockers(detail);
  const active = detail.agents.filter((a) => a.state !== 'idle' && a.state !== 'offline').length;
  const activeBranch = coding.session?.branch || detail.codingSession?.branch;

  return (
    <div className="room-view" aria-label={`Project room ${detail.key}`}>
      <header className="room-hero">
        <div className="room-hero-main">
          <p className="room-hero-client">{detail.client}{detail.group !== '-' ? ` · ${detail.group}` : ''}</p>
          <h1 className="room-hero-key">{detail.key}</h1>
          {detail.description && <p className="room-hero-desc">{detail.description}</p>}
        </div>
        <dl className="room-hero-facts">
          <div><dt>Stage</dt><dd>{detail.memory.stage || 'not set'}</dd></div>
          <div><dt>Focus</dt><dd>{detail.memory.focus || 'not set'}</dd></div>
        </dl>
        <div className="room-chips">
          <span className="chip">{detail.agents.length} in the room{active ? ` · ${active} active` : ''}</span>
          <span className={`chip${holds.length ? ' is-attn' : ''}`}>{holds.length} {holds.length === 1 ? 'blocker' : 'blockers'}</span>
          <span className="chip">{detail.runs.length} open {detail.runs.length === 1 ? 'run' : 'runs'}</span>
          {activeBranch && <span className="chip is-accent">coding on {activeBranch}</span>}
          <button type="button" className="btn btn-primary" onClick={() => onAssistant(detail.key)}>Talk to the agent</button>
        </div>
      </header>

      <div className="room-view-switch" role="group" aria-label="Project room views">
        <button type="button" aria-pressed={roomView === 'room'} onClick={() => setRoomView('room')}>Room</button>
        <button type="button" aria-pressed={roomView === 'context'} onClick={() => setRoomView('context')}>Visual context</button>
      </div>

      {roomView === 'context' ? (
        <Suspense fallback={<p className="desk-loading" role="status">Loading visual project context...</p>}>
          <ProjectContextAtlas detail={detail} />
        </Suspense>
      ) : (
        <div className="room-grid">
        <MissionBoard
          detail={detail}
          coding={coding}
          onChanged={() => {
            reload();
            void coding.refresh();
          }}
        />

        <aside className="room-side">
          <section className="panel" aria-label="Crew">
            <h2 className="panel-title">Crew</h2>
            {detail.agents.length === 0 ? <p className="panel-empty">Nobody is here right now.</p> : (
              <ul className="crew">
                {detail.agents.map((agent) => (
                  <li key={agent.id}>
                    <button type="button" className="crew-member" onClick={() => onAgent(agent)} aria-label={`${agent.tool}: ${STATE_LABELS[agent.state]}`}>
                      <AgentFigure key={agent.state} state={agent.state} tool={agent.tool} size={44} />
                      <span className="crew-name">{agent.tool}</span>
                      <span className={`crew-state state-${agent.state}`}>{STATE_LABELS[agent.state]}</span>
                      {agent.detail && <span className="crew-detail">{agent.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-label="Blockers">
            <h2 className="panel-title">Blockers</h2>
            {holds.length === 0 ? <p className="panel-empty">Nothing is holding this project up.</p> : (
              <ul className="holds">
                {holds.map((hold, i) => (
                  <li key={i} className={`hold hold-${hold.kind}`}>
                    <span className="hold-kind">{hold.kind === 'approval' ? <HandGlyph /> : null}{KIND_LABEL[hold.kind]}</span>
                    <span className="hold-text">{hold.text}</span>
                    {hold.detail && <span className="hold-detail">{hold.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-label="Memory">
            <h2 className="panel-title">Memory{detail.memory.updated ? <span className="panel-sub"> · updated {detail.memory.updated}</span> : null}</h2>
            {detail.memory.nextUp.length > 0 && (
              <>
                <h3 className="panel-sub-title">Next up</h3>
                <ul className="memory-list">{detail.memory.nextUp.slice(0, 5).map((item, i) => <li key={i}>{item}</li>)}</ul>
              </>
            )}
            {detail.memory.decisions.length > 0 && (
              <>
                <h3 className="panel-sub-title">Decisions</h3>
                <ul className="memory-list">{detail.memory.decisions.map((d, i) => <li key={i}><span className="memory-date">{d.date}</span>{d.title}</li>)}</ul>
              </>
            )}
            {detail.memory.log.length > 0 && (
              <>
                <h3 className="panel-sub-title">Log</h3>
                <ul className="memory-list">{detail.memory.log.map((entry, i) => <li key={i}><span className="memory-date">{entry.date}</span>{entry.text}</li>)}</ul>
              </>
            )}
            <h3 className="panel-sub-title">Notes</h3>
            {detail.memory.notes.length === 0 ? <p className="panel-empty">No notes yet.</p> : (
              <ul className="memory-list">{detail.memory.notes.map((n) => <li key={n.name}><strong>{n.name}</strong>{n.excerpt ? ` - ${n.excerpt}` : ''}</li>)}</ul>
            )}
            <button type="button" className="mission-link" onClick={() => onNotes(detail.key)}>Add a note</button>
          </section>

          <section className="panel" aria-label="Context">
            <h2 className="panel-title">Context</h2>
            <h3 className="panel-sub-title">An agent bound here loads</h3>
            <ul className="context-files">{detail.context.pack.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
            <h3 className="panel-sub-title">It may reach</h3>
            <p className="context-policy">
              {detail.context.policy
                ? <>Autonomy: <strong>{detail.context.policy.default}</strong>. Endpoints: {detail.context.policy.endpoints.length ? detail.context.policy.endpoints.join(', ') : 'local only'}.</>
                : <>No policy yet: local endpoints only, and commands and file edits are refused. Add <code>.local/agent/policies/{detail.key}.json</code> to allow them.</>}
            </p>
          </section>
        </aside>
        </div>
      )}
    </div>
  );
}
