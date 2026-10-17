import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { PmAlert } from './types';

/**
 * One `desk/pm/*` read, reloaded on demand and whenever `version` changes. Errors are kept
 * beside the last good answer, so a failed refresh does not blank the view.
 */
export function usePmRead<T>(path: string | null, version: unknown = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    apiFetch<T>(path)
      .then((next) => { setData(next); setError(''); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [path]);
  useEffect(reload, [reload, version]);
  return { data, error, loading, reload };
}

/** Alerts other than the floor's own (approvals and raised hands are on the floor already). */
const NOTIFIED = new Set(['overdue', 'due_today', 'reminder']);
const POLL_MS = 60_000;

/**
 * The computed alerts, polled once a minute. A new overdue, due, or reminder alert raises a
 * browser notification - in this browser only; nothing leaves the machine (ADR-0024).
 */
export function usePmAlerts() {
  const [alerts, setAlerts] = useState<PmAlert[]>([]);
  const [error, setError] = useState('');
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(() => {
    apiFetch<{ alerts: PmAlert[] }>('desk/pm/alerts')
      .then(({ alerts: next }) => {
        setAlerts(next);
        setError('');
        const known = seen.current;
        seen.current = new Set(next.map((a) => a.id));
        if (!known || typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
        const fresh = next.filter((a) => NOTIFIED.has(a.kind) && !known.has(a.id));
        if (fresh.length === 0) return;
        try {
          const first = fresh[0];
          const note = new Notification(fresh.length === 1 ? first.title : `${fresh.length} new alerts`, {
            body: fresh.length === 1 ? `${first.scope}: ${first.detail}` : fresh.slice(0, 3).map((a) => a.title).join(' · '),
            tag: 'desk-alerts',
          });
          note.onclick = () => window.focus();
        } catch {
          // A notification can be refused outside a secure context; the Inbox still shows it.
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const snooze = useCallback(async (id: string, length: string) => {
    await apiFetch('desk/pm/alerts/snooze', { method: 'POST', body: JSON.stringify({ id, for: length }) });
    refresh();
  }, [refresh]);

  return { alerts, error, refresh, snooze };
}
