import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Props {
  projects: string[];
  clients: string[];
  onAdded: () => void;
  draft?: { scope: string; title: string } | null;
  onDraftConsumed?: () => void;
}

/** A new mission, straight into a project's queue or a client's own work, through `ws task add`. */
export function QuickAdd({ projects, clients, onAdded, draft, onDraftConsumed }: Props) {
  const [title, setTitle] = useState(draft?.title ?? '');
  const [scope, setScope] = useState(draft?.scope ?? '');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDraftHint, setShowDraftHint] = useState(Boolean(draft));
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setScope(draft.scope);
    setError('');
    setShowDraftHint(true);
    titleRef.current?.focus();
    onDraftConsumed?.();
  }, [draft, onDraftConsumed]);

  const submit = async () => {
    if (!title.trim()) { setError('a mission needs a title'); return; }
    if (!scope) { setError('choose a project or a client'); return; }
    setBusy(true);
    try {
      await apiFetch('desk/pm/tasks', { method: 'POST', body: JSON.stringify({ scope, title, due: due || undefined }) });
      setTitle('');
      setDue('');
      setError('');
      setShowDraftHint(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="quick-add" aria-label="New mission" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New mission..." aria-label="Mission title" aria-describedby={showDraftHint ? 'quick-add-draft-hint' : undefined} />
      <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="For">
        <option value="">For...</option>
        <optgroup label="Projects">{projects.map((p) => <option key={p} value={p}>{p}</option>)}</optgroup>
        <optgroup label="Clients (their own work)">{clients.map((c) => <option key={c} value={`@${c}`}>{c}</option>)}</optgroup>
      </select>
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
      <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
      {showDraftHint && <p id="quick-add-draft-hint" className="quick-add-hint">Suggested from the response. Review and edit before adding.</p>}
      {error && <p className="board-error" role="alert">[ERROR] {error}</p>}
    </form>
  );
}
