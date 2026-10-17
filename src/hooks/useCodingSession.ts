import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { CodingSession } from '../lib/types';

/** The selected project's coding session (Agent-Workspace ADR-0019): a `ws agent start` worktree its mutating tools then work in. */
export function useCodingSession(project: string | undefined) {
  const [session, setSession] = useState<CodingSession | null>(null);
  /** False until the first answer for `project`: until then neither Start nor Stop is true. */
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setKnown(false);
    if (!project) { setSession(null); return; }
    apiFetch<{ session: CodingSession | null }>(`coding-sessions/${encodeURIComponent(project)}`)
      .then((data) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setKnown(true));
  }, [project]);

  useEffect(refresh, [refresh]);

  // A verify runs in the background on the host; follow it until it settles.
  const verifying = session?.verify?.state === 'running';
  useEffect(() => {
    if (!verifying) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [verifying, refresh]);

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

  /** Runs a hand-back step; the host answers with the reason when it refuses. */
  const handBack = useCallback(async (step: 'verify' | 'ship' | 'discard', body?: Record<string, string>) => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch<{ session?: CodingSession }>(`coding-sessions/${encodeURIComponent(project)}/${step}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      if (step === 'discard') setSession(null);
      else if (data.session) setSession(data.session);
      else refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${step}`);
      refresh();
    } finally {
      setBusy(false);
    }
  }, [project, busy, refresh]);

  return { session, known, start, stop, handBack, busy, error };
}
