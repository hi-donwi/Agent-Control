import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { CodingSession } from '../lib/types';

/** The selected project's coding session (Agent-Workspace ADR-0019): a `ws agent start` worktree its mutating tools then work in. */
export function useCodingSession(project: string | undefined) {
  const [session, setSession] = useState<CodingSession | null>(null);
  const [sessions, setSessions] = useState<CodingSession[]>([]);
  /** False until the first answer for `project`: until then neither Start nor Stop is true. */
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setKnown(false);
    if (!project) {
      setSession(null);
      setSessions([]);
      return;
    }
    apiFetch<{ session: CodingSession | null; sessions?: CodingSession[] }>(`coding-sessions/${encodeURIComponent(project)}`)
      .then((data) => {
        setSession(data.session);
        setSessions(data.sessions ?? (data.session ? [data.session] : []));
      })
      .catch(() => {
        setSession(null);
        setSessions([]);
      })
      .finally(() => setKnown(true));
  }, [project]);

  useEffect(refresh, [refresh]);

  // A verify runs in the background on the host; follow it until it settles.
  const verifying = sessions.some((s) => s.verify?.state === 'running') || session?.verify?.state === 'running';
  useEffect(() => {
    if (!verifying) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [verifying, refresh]);

  const sessionForCard = useCallback(
    (cardKey: string): CodingSession | null => {
      return sessions.find((s) => s.cardKey === cardKey) ?? (session?.cardKey === cardKey ? session : null);
    },
    [sessions, session],
  );

  const start = useCallback(async (opts?: { brief?: string; cardKey?: string }) => {
    if (!project || busy) return null;
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch<{ session: CodingSession }>(`coding-sessions/${encodeURIComponent(project)}/start`, {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      });
      setSession(data.session);
      refresh();
      return data.session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
      return null;
    } finally {
      setBusy(false);
    }
  }, [project, busy, refresh]);

  const stop = useCallback(async (sessionId?: string) => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`coding-sessions/${encodeURIComponent(project)}/stop`, {
        method: 'POST',
        body: JSON.stringify(sessionId ? { sessionId } : {}),
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    } finally {
      setBusy(false);
    }
  }, [project, busy, refresh]);

  /** Runs a hand-back step; the host answers with the reason when it refuses. */
  const handBack = useCallback(async (
    step: 'verify' | 'ship' | 'discard',
    body?: Record<string, string>,
    sessionId?: string,
  ): Promise<boolean> => {
    if (!project || busy) return false;
    setBusy(true);
    setError('');
    try {
      const payload = { ...body, ...(sessionId ? { sessionId } : {}) };
      const data = await apiFetch<{ session?: CodingSession }>(`coding-sessions/${encodeURIComponent(project)}/${step}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (step === 'discard') {
        refresh();
      } else if (data.session) {
        setSession(data.session);
        refresh();
      } else {
        refresh();
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${step}`);
      refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }, [project, busy, refresh]);

  return { session, sessions, sessionForCard, known, start, stop, handBack, refresh, busy, error };
}
