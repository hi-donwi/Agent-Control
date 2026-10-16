import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { ProjectDetail } from '../types';

/** A busy agent moves the floor every second; the room follows it at most this often. */
const MIN_GAP_MS = 2000;

/**
 * One project's room. It reloads when `version` changes - the desk derives it from this
 * project's room on the floor, so it moves with this project's agents, approvals, and
 * session, not with every other project's - at most once per `MIN_GAP_MS`, keeping the
 * latest change. A change the room makes itself reloads at once through `reload`.
 */
export function useProject(key: string, version: string) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const last = useRef(0);

  const reload = useCallback(() => {
    last.current = Date.now();
    apiFetch<ProjectDetail>(`desk/projects/${encodeURIComponent(key)}`)
      .then((next) => { setDetail(next); setError(''); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [key]);

  useEffect(() => {
    const id = setTimeout(reload, Math.max(0, last.current + MIN_GAP_MS - Date.now()));
    return () => clearTimeout(id);
  }, [reload, version]);

  return { detail, error, reload };
}
