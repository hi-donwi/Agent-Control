import { usePmRead } from './usePm';
import type { PmClientPulse } from './types';
import { ago } from '../time';

interface Props {
  version: string;
  onOpenClient: (key: string) => void;
}

function since(iso: string): string {
  if (!iso) return 'no interaction yet';
  const age = ago(iso);
  return age === 'now' ? 'touched today' : `touched ${age} ago`;
}

/** Every client at a glance - open work, what is late, what alerts - each opening its dossier. */
export function ClientsView({ version, onOpenClient }: Props) {
  const { data, error } = usePmRead<{ clients: PmClientPulse[] }>('desk/pm/clients', version);
  return (
    <div className="pm-view" aria-label="Clients">
      <header className="pm-head">
        <div>
          <p className="pm-kicker">Missions</p>
          <h1 className="pm-title">Clients</h1>
        </div>
        <span className="pm-date">{data ? `${data.clients.length} clients` : ''}</span>
      </header>
      {error && !data && <p className="board-error" role="alert">[ERROR] {error}</p>}
      {!data ? <p className="desk-loading" role="status">Reading clients...</p> : (
        <ul className="client-cards">
          {data.clients.map((client) => (
            <li key={client.key}>
              <button type="button" className="client-card" onClick={() => onOpenClient(client.key)} aria-label={`Client ${client.key}`}>
                <span className="client-card-key">{client.key}</span>
                {client.name && <span className="client-card-name">{client.name}</span>}
                <span className="client-card-stats">
                  <span>{client.projects} {client.projects === 1 ? 'project' : 'projects'}</span>
                  <span>{client.open} open</span>
                  {client.overdue > 0 && <span className="is-warn">{client.overdue} late</span>}
                  {client.alerts > 0 && <span className="is-attn">{client.alerts} alerts</span>}
                </span>
                <span className="client-card-when">{client.error ? `[ERROR] ${client.error}` : since(client.lastInteraction)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
