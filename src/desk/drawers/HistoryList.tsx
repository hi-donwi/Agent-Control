import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { ago } from '../time';

interface Summary {
  id: string;
  title: string;
  messages: number;
  updatedAt: string;
}

interface Props {
  /** '' is the workspace; otherwise the project whose conversations are listed. */
  scope: string;
  /** The conversation on screen. */
  current: string;
  /** Rejects when the host refuses; the list stays and says why. */
  onOpen: (id: string) => Promise<void>;
}

/**
 * The scope's earlier conversations, newest first. Only this scope's: the host lists and
 * opens a conversation within its own scope, so one project's history never shows in another.
 */
function when(iso: string): string {
  const age = ago(iso);
  return age === 'now' ? 'just now' : `${age} ago`;
}

export function HistoryList({ scope, current, onOpen }: Props) {
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiFetch<{ conversations: Summary[] }>(`conversations?scope=${encodeURIComponent(scope || '_workspace')}`)
      .then((data) => { if (live) { setItems(data.conversations); setError(''); } })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [scope]);

  if (error) return <p className="assistant-error" role="alert">[ERROR] {error}</p>;
  if (!items) return <p className="assistant-empty" role="status">Loading earlier conversations...</p>;

  return (
    <nav className="history" aria-label="Earlier conversations">
      {items.length === 0 ? (
        <p className="history-empty">No earlier conversations {scope ? `in ${scope}` : 'in the workspace'}.</p>
      ) : (
        <ol className="history-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="history-item"
                aria-current={item.id === current ? 'true' : undefined}
                onClick={() => { onOpen(item.id).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))); }}
              >
                <span className="history-title">{item.title || 'Untitled conversation'}</span>
                <span className="history-meta">
                  {item.messages} {item.messages === 1 ? 'message' : 'messages'} · {when(item.updatedAt)}
                  {item.id === current ? ' · open' : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
