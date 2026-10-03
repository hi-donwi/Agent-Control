import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ApprovalRequest } from '../lib/types';

const POLL_MS = 5000;

/**
 * Pending local approval requests (Agent-Workspace ADR-0020) for a project. Polls while
 * a project is selected; a project with no policy, or no pending requests, is silently
 * empty - this is a convenience inbox, not where the operator finds out policy is missing.
 */
export function useApprovals(project: string | undefined) {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const deciding = useRef(new Set<string>());
  const [decidingIds, setDecidingIds] = useState<string[]>([]);

  const refresh = useCallback(() => {
    if (!project) { setPending([]); return; }
    apiFetch<{ pending: ApprovalRequest[] }>(`approvals?project=${encodeURIComponent(project)}`)
      .then((data) => setPending(data.pending))
      .catch(() => { /* no policy, or workspace unreachable: nothing to show */ });
  }, [project]);

  useEffect(() => {
    refresh();
    if (!project) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [project, refresh]);

  const decide = useCallback(async (id: string, decision: 'approved' | 'denied') => {
    if (!project || deciding.current.has(id)) return;
    deciding.current.add(id);
    setDecidingIds([...deciding.current]);
    try {
      await apiFetch('approvals/decide', { method: 'POST', body: JSON.stringify({ project, id, decision }) });
      setPending((prev) => prev.filter((r) => r.id !== id));
    } finally {
      deciding.current.delete(id);
      setDecidingIds([...deciding.current]);
    }
  }, [project]);

  return { pending, decide, decidingIds };
}
