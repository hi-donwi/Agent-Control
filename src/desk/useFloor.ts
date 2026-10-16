import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Floor } from './types';

const POLL_MS = 5000;

/**
 * The floor, polled every five seconds while the page is visible (server-sent events are
 * phase 2). A failed poll keeps the last floor on screen and reports the error.
 */
export function useFloor() {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<Floor>('desk/floor')
      .then((next) => { setFloor(next); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { floor, error, refresh };
}
