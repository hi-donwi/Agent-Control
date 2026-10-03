import { useEffect, useState } from 'react';
import { formatExpiry, isExpired } from '../../lib/approval-format';
import type { ApprovalRequest } from '../../lib/types';

interface Props {
  requests: ApprovalRequest[];
  onDecide: (id: string, decision: 'approved' | 'denied') => void;
  decidingIds: string[];
}

/** The operator's inbox for local approval requests (Agent-Workspace ADR-0020). */
export function ApprovalInbox({ requests, onDecide, decidingIds }: Props) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const live = requests.filter((r) => !isExpired(r.expiresAt));
  if (live.length === 0) return null;

  return (
    <div className="approval-inbox" role="region" aria-label="Pending approvals">
      <div className="approval-inbox-title">
        Pending approval{live.length > 1 ? 's' : ''} ({live.length})
      </div>
      {live.map((req) => (
        <div className="approval-item" key={req.id}>
          <div className="approval-item-main">
            <span className="approval-action">{req.action}</span>
            <span className="approval-expiry">{formatExpiry(req.expiresAt)}</span>
          </div>
          <div className="approval-item-detail">
            request {req.id.slice(0, 8)} · revision {req.headSha.slice(0, 8)}
          </div>
          <div className="approval-item-actions">
            <button
              className="btn-approve"
              type="button"
              disabled={decidingIds.includes(req.id)}
              onClick={() => onDecide(req.id, 'approved')}
            >
              Approve
            </button>
            <button
              className="btn-deny"
              type="button"
              disabled={decidingIds.includes(req.id)}
              onClick={() => onDecide(req.id, 'denied')}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
