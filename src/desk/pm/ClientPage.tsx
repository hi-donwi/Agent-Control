import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { usePmRead } from './usePm';
import type { PmTask } from './types';

interface Dossier {
  client: string;
  profile: { title: string; fields: Record<string, string>; about: string; working_agreement: string; stakeholders: string };
  projects: Array<{ key: string; open: number; overdue: number }>;
  tasks: PmTask[];
  open: number;
  overdue: number;
  alerts: number;
  interactions: Array<{ at: string; actor: string; text: string }>;
  restrictedText: { contacts: string | null; commercial: string | null };
}

interface Props {
  client: string;
  version: string;
  onOpenProject: (key: string) => void;
  onOpenTask: (scope: string, id: string) => void;
}

/**
 * One client's dossier: who they are and how to work with them, their projects and their
 * own open work, the interaction log, and - for the operator only - their contacts and
 * commercial terms. Those two never reach an agent (ADR-0024): no `ws` command prints them.
 */
export function ClientPage({ client, version, onOpenProject, onOpenTask }: Props) {
  const [reloads, setReloads] = useState(0);
  const { data, error } = usePmRead<Dossier>(`desk/pm/clients/${encodeURIComponent(client)}`, `${version}:${reloads}`);
  const [entry, setEntry] = useState('');
  const [logError, setLogError] = useState('');

  const log = async () => {
    if (!entry.trim()) { setLogError('an entry needs text'); return; }
    try {
      await apiFetch(`desk/pm/clients/${encodeURIComponent(client)}/log`, { method: 'POST', body: JSON.stringify({ text: entry }) });
      setEntry('');
      setLogError('');
      setReloads((n) => n + 1);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && !data) return <p className="desk-loading" role="alert">[ERROR] {error}</p>;
  if (!data) return <p className="desk-loading" role="status">Opening {client}...</p>;
  const fields = Object.entries(data.profile.fields).filter(([, value]) => value);

  return (
    <div className="pm-view" aria-label={`Client ${client}`}>
      <header className="room-hero">
        <div>
          <p className="room-hero-client">Client</p>
          <h1 className="room-hero-key">{client}</h1>
          {data.profile.about && <p className="room-hero-desc">{data.profile.about}</p>}
        </div>
        <dl className="room-hero-facts">
          {fields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
        </dl>
        <div className="room-chips">
          <span className="chip">{data.projects.length} {data.projects.length === 1 ? 'project' : 'projects'}</span>
          <span className="chip">{data.open} open</span>
          <span className={`chip${data.overdue ? ' is-attn' : ''}`}>{data.overdue} late</span>
          <span className="chip">{data.alerts} alerts</span>
        </div>
      </header>

      <div className="room-grid">
        <div className="client-main">
          <section className="panel" aria-label="Projects">
            <h2 className="panel-title">Projects</h2>
            {data.projects.length === 0 ? <p className="panel-empty">No project registered for this client.</p> : (
              <ul className="memory-list">
                {data.projects.map((p) => (
                  <li key={p.key}>
                    <button type="button" className="mission-link" onClick={() => onOpenProject(p.key)}>{p.key}</button>
                    <span className="memory-date"> · {p.open} open{p.overdue ? `, ${p.overdue} late` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel" aria-label="Their own work">
            <h2 className="panel-title">Their own work <span className="panel-sub">· follow-ups, reports, invoices</span></h2>
            {data.tasks.length === 0 ? <p className="panel-empty">Nothing open for the client itself.</p> : (
              <ul className="memory-list">
                {data.tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="mission-link is-plain" onClick={() => onOpenTask(t.scope, t.id)}>{t.title}</button>
                    <span className="memory-date">{t.due ? ` · due ${t.due}` : ''} · {t.status.replace('_', ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel" aria-label="Interactions">
            <h2 className="panel-title">Interactions</h2>
            <form className="task-inline" onSubmit={(e) => { e.preventDefault(); void log(); }}>
              <input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Call: agreed the phase 2 scope" aria-label="New interaction" />
              <button type="submit" className="btn btn-primary">Log</button>
            </form>
            {logError && <p className="board-error" role="alert">[ERROR] {logError}</p>}
            {data.interactions.length === 0 ? <p className="panel-empty">No interaction logged yet.</p> : (
              <ol className="task-activity">
                {data.interactions.map((i, n) => <li key={n}><span className="memory-date">{i.at.slice(0, 16).replace('T', ' ')}</span> <b>{i.actor}</b> {i.text}</li>)}
              </ol>
            )}
          </section>
        </div>

        <aside className="room-side">
          {(data.profile.working_agreement || data.profile.stakeholders) && (
            <section className="panel" aria-label="Working with them">
              <h2 className="panel-title">Working with them</h2>
              {data.profile.working_agreement && <p className="task-description">{data.profile.working_agreement}</p>}
              {data.profile.stakeholders && <><h3 className="panel-sub-title">Stakeholders</h3><p className="task-description">{data.profile.stakeholders}</p></>}
            </section>
          )}
          {(['contacts', 'commercial'] as const).map((name) => (
            <section key={name} className="panel restricted" aria-label={name === 'contacts' ? 'Contacts' : 'Commercial terms'}>
              <h2 className="panel-title">{name === 'contacts' ? 'Contacts' : 'Commercial terms'} <span className="restricted-badge">desk only</span></h2>
              {data.restrictedText[name]
                ? <pre className="restricted-text">{data.restrictedText[name]}</pre>
                : <p className="panel-empty">None yet. Add <code>context/clients/{client}/{name}.md</code>; it never reaches an agent.</p>}
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}
