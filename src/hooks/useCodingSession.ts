import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { CodingSession } from '../lib/types';

/** The selected project's coding session (Agent-Workspace ADR-0019): a `ws agent start` worktree its mutating tools then work in. */
export function useCodingSession(project: string | undefined) {
  const [session, setSession] = useState<CodingSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    if (!project) { setSession(null); return; }
    apiFetch<{ session: CodingSession | null }>(`coding-sessions/${encodeURIComponent(project)}`)
      .then((data) => setSession(data.session))
      .catch(() => setSession(null));
  }, [project]);

  useEffect(refresh, [refresh]);

  const start = useCallback(async () => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch<{ session: CodingSession }>(`coding-sessions/${encodeURIComponent(project)}/start`, { method: 'POST' });
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setBusy(false);
    }
  }, [project, busy]);

  const stop = useCallback(async () => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`coding-sessions/${encodeURIComponent(project)}/stop`, { method: 'POST' });
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    } finally {
      setBusy(false);
    }
  }, [project, busy]);

  return { session, start, stop, busy, error };
}
