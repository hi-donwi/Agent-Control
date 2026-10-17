import { useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Props {
  projects: string[];
  clients: string[];
  onAdded: () => void;
}

/** A new mission, straight into a project's queue or a client's own work, through `ws task add`. */
export function QuickAdd({ projects, clients, onAdded }: Props) {
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) { setError('a mission needs a title'); return; }
    if (!scope) { setError('choose a project or a client'); return; }
    setBusy(true);
    try {
      await apiFetch('desk/pm/tasks', { method: 'POST', body: JSON.stringify({ scope, title, due: due || undefined }) });
      setTitle('');
      setDue('');
      setError('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="quick-add" aria-label="New mission" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New mission..." aria-label="Mission title" />
      <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="For">
        <option value="">For...</option>
        <optgroup label="Projects">{projects.map((p) => <option key={p} value={p}>{p}</option>)}</optgroup>
        <optgroup label="Clients (their own work)">{clients.map((c) => <option key={c} value={`@${c}`}>{c}</option>)}</optgroup>
      </select>
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
      <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
      {error && <p className="board-error" role="alert">[ERROR] {error}</p>}
    </form>
  );
}
