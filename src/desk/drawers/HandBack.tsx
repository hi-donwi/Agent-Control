import { useState } from 'react';
import { ago } from '../time';
import type { useCodingSession } from '../../hooks/useCodingSession';
import type { CodingSession, SessionVerify } from '../../lib/types';

const STATE_TEXT: Record<SessionVerify['state'], string> = {
  running: 'Verifying...',
  pass: '[PASS] Verify passed on this worktree',
  findings: '[FAIL] Verify found problems',
  incomplete: '[WARN] The verification contract is incomplete',
  stale: '[WARN] The worktree changed while verify ran; verify again',
  error: '[ERROR] Verify could not run',
};

function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : ` · ${(ms / 1000).toFixed(1)} s`;
}

/**
 * Handing a coding session's work back: verify it in its worktree, then ship it to the
 * project's default branch or discard it. Ship opens only while the last verify passed on
 * exactly the content in the worktree, and both ship and discard ask once more before
 * they act - a push and a deleted branch cannot be taken back.
 */
interface Props {
  coding: ReturnType<typeof useCodingSession>;
  session?: CodingSession;
  onShipped?: () => void;
}

export function HandBack({ coding, session: propSession, onShipped }: Props) {
  const session = propSession ?? coding.session;
  const { handBack, busy, error } = coding;
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'ship' | 'discard' | null>(null);
  if (!session) return null;

  const verify = session.verify;
  const canShip = verify?.state === 'pass' && !busy;

  return (
    <section className="handback" aria-label="Hand back">
      <h3 className="handback-title">Hand back</h3>

      {error && <p className="handback-detail handback-error" role="alert">[ERROR] {error}</p>}

      <div className="handback-row">
        <button type="button" className="btn" onClick={() => void handBack('verify', undefined, session.id)} disabled={busy || verify?.state === 'running'}>
          {verify ? 'Verify again' : 'Verify'}
        </button>
        <span className={`handback-state is-${verify?.state ?? 'none'}`} role="status">
          {verify ? STATE_TEXT[verify.state] : 'Not verified yet: ws verify runs the project contract in this worktree.'}
        </span>
      </div>
      {verify?.error && <p className="handback-detail">{verify.error}</p>}
      {verify?.commands && verify.commands.length > 0 && (
        <ul className="handback-commands" aria-label="Verification commands">
          {verify.commands.map((command) => (
            <li key={command.id}>
              <span className={`handback-cmd is-${command.status}`}>{command.status}</span>
              <span>{command.id}{command.required === false ? ' (optional)' : ''}{seconds(command.duration_ms)}</span>
            </li>
          ))}
        </ul>
      )}

      <form className="handback-ship" onSubmit={(event) => { event.preventDefault(); setConfirm('ship'); }}>
        <input
          aria-label="Commit message"
          placeholder="Commit message for uncommitted changes"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!canShip}>Ship to main</button>
      </form>
      {!canShip && verify?.state !== 'running' && (
        <p className="handback-hint">Ship opens once verify passes on what is in the worktree now.</p>
      )}
      {confirm === 'ship' && (
        <div className="handback-confirm" role="alertdialog" aria-label="Confirm ship">
          <p>Push <code>{session.branch}</code> to the default branch on origin? Only a fast-forward is pushed, and a push cannot be taken back.</p>
          <div className="handback-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                setConfirm(null);
                const ok = await handBack('ship', { message }, session.id);
                if (ok) onShipped?.();
              }}
            >
              Push to main
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {session.shipped && (
        <p className="handback-shipped" role="status">
          [PASS] Shipped <code>{session.shipped.head.slice(0, 8)}</code> to {session.shipped.base}
          {' '}({session.shipped.commits} {session.shipped.commits === 1 ? 'commit' : 'commits'}), {ago(session.shipped.at) === 'now' ? 'just now' : `${ago(session.shipped.at)} ago`}.
        </p>
      )}

      {confirm === 'discard' ? (
        <div className="handback-confirm is-danger" role="alertdialog" aria-label="Confirm discard">
          <p>Delete the worktree and the branch <code>{session.branch}</code>, with every change in them?</p>
          <div className="handback-actions">
            <button type="button" className="btn btn-danger" onClick={() => { setConfirm(null); void handBack('discard', undefined, session.id); }}>Discard everything</button>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="mission-link handback-discard" onClick={() => setConfirm('discard')} disabled={busy}>
          Discard session
        </button>
      )}
    </section>
  );
}
