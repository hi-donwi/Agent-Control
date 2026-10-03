import type { CodingSession } from '../../lib/types';

interface Props {
  session: CodingSession | null;
  busy: boolean;
  error: string;
  onStart: () => void;
  onStop: () => void;
}

/** Shortens an absolute worktree path to its last two segments, for display. */
function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 2 ? path : '.../' + parts.slice(-2).join('/');
}

/** Start/stop control for the selected project's coding session (Agent-Workspace ADR-0019). */
export function CodingSessionPanel({ session, busy, error, onStart, onStop }: Props) {
  return (
    <div className="coding-session-panel">
      {session ? (
        <>
          <div className="coding-session-status">
            <span className="status-dot" />
            <span>Coding session active</span>
          </div>
          <div className="coding-session-detail" title={session.worktree}>
            {shortPath(session.worktree)} · {session.branch}
          </div>
          <button className="btn-secondary" type="button" disabled={busy} onClick={onStop}>
            {busy ? 'Stopping...' : 'Stop coding session'}
          </button>
        </>
      ) : (
        <button className="btn-secondary" type="button" disabled={busy} onClick={onStart}>
          {busy ? 'Starting...' : 'Start coding session'}
        </button>
      )}
      {error && <p className="selector-note" role="status">{error}</p>}
    </div>
  );
}
