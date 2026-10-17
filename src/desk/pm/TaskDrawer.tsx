import { useState } from 'react';
import { Drawer } from '../drawers/Drawer';
import { CloseIcon } from '../icons';
import { HandGlyph } from '../room/glyphs';
import { apiFetch } from '../../lib/api';
import { usePmRead } from './usePm';
import type { PmTask } from './types';

interface Props {
  scope: string;
  id: string;
  onClose: () => void;
  /** Called after every change the drawer makes, so the board behind it follows. */
  onChanged: () => void;
}

const STATUS_LABEL: Record<PmTask['status'], string> = {
  backlog: 'Queue', ready: 'Ready for an agent', in_progress: 'In hands', review: 'Awaiting review', done: 'Shipped',
};
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/**
 * One task in full: its station, fields, checklist, acceptance criteria, blocker, and its
 * activity - every change by a person or an agent. Every edit is one `ws` command with the
 * revision the drawer read; a stale one is refused and the drawer reloads.
 */
export function TaskDrawer({ scope, id, onClose, onChanged }: Props) {
  const [version, setVersion] = useState(0);
  const { data: task, error: loadError } = usePmRead<PmTask>(`desk/pm/tasks/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, version);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [item, setItem] = useState('');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');

  const act = async (path: string, body: Record<string, unknown>) => {
    if (!task) return;
    setBusy(true);
    try {
      await apiFetch(`desk/pm/${path}`, { method: 'POST', body: JSON.stringify({ scope, id, revision: task.revision, ...body }) });
      setError('');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
      onChanged();
    }
  };
  const edit = (changes: Record<string, unknown>) => act('tasks/edit', { changes });

  return (
    <Drawer label="Task" wide onClose={onClose}>
      <header className="drawer-head">
        <h2 className="drawer-title">{task?.title ?? id}<span className="drawer-subtitle"> · {scope}</span></h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close task"><CloseIcon /></button>
      </header>
      <div className="drawer-body task-drawer">
        {!task ? <p className="drawer-empty" role={loadError ? 'alert' : 'status'}>{loadError ? `[ERROR] ${loadError}` : 'Reading the task...'}</p> : (
          <>
            {error && <p className="board-error" role="alert">[ERROR] {error}</p>}
            <div className="task-fields">
              <label>
                <span>Station</span>
                <select value={task.status} disabled={busy} onChange={(e) => void act('tasks/status', { status: e.target.value })}>
                  {Object.entries(STATUS_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
              <label>
                <span>Priority</span>
                <select value={task.priority} disabled={busy} onChange={(e) => void edit({ priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label>
                <span>Due</span>
                <input type="date" value={task.due} disabled={busy} aria-label="Due date"
                  onChange={(e) => void edit({ due: e.target.value || 'none' })} />
              </label>
              <label>
                <span>Assignee</span>
                <input defaultValue={task.assignee} key={`assignee-${task.revision}`} placeholder="a person, or agent:claude" disabled={busy}
                  aria-label="Assignee" onBlur={(e) => { const v = e.target.value.trim(); if (v !== task.assignee) void edit({ assignee: v || 'none' }); }} />
              </label>
            </div>

            {task.blocked ? (
              <div className="task-blocked">
                <span className="mission-blocked"><HandGlyph /><span>Blocked: {task.blocked_reason}</span></span>
                <button type="button" className="btn" disabled={busy} onClick={() => void act('tasks/unblock', {})}>Unblock</button>
              </div>
            ) : (
              <form className="task-inline" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void act('tasks/block', { reason }).then((ok) => ok && setReason('')); }}>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What blocks it?" aria-label="What blocks it" />
                <button type="submit" className="btn" disabled={busy || !reason.trim()}>Block</button>
              </form>
            )}

            <section aria-label="Labels" className="task-section">
              <h3 className="panel-sub-title">Labels</h3>
              <div className="task-labels">
                {task.labels.map((l) => (
                  <button key={l} type="button" className="chip" disabled={busy} aria-label={`Remove label ${l}`} onClick={() => void edit({ labels_rm: [l] })}>{l} x</button>
                ))}
                <form className="task-inline" onSubmit={(e) => { e.preventDefault(); if (label.trim()) void edit({ labels_add: [label.trim()] }).then((ok) => ok && setLabel('')); }}>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="add a label" aria-label="New label" />
                </form>
              </div>
            </section>

            <section aria-label="Checklist" className="task-section">
              <h3 className="panel-sub-title">Checklist {task.checklist.length > 0 && `· ${task.checklist.filter((c) => c.done).length}/${task.checklist.length}`}</h3>
              <ul className="task-checklist">
                {task.checklist.map((c) => (
                  <li key={c.n}>
                    <label>
                      <input type="checkbox" checked={c.done} disabled={busy} onChange={() => void act('tasks/check', { n: c.n })} />
                      <span>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <form className="task-inline" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void edit({ check_add: [item.trim()] }).then((ok) => ok && setItem('')); }}>
                <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="add an item" aria-label="New checklist item" />
                <button type="submit" className="btn" disabled={busy || !item.trim()}>Add</button>
              </form>
            </section>

            {(task.description || task.acceptance_criteria.length > 0) && (
              <section aria-label="Description" className="task-section">
                {task.description && <p className="task-description">{task.description}</p>}
                {task.acceptance_criteria.length > 0 && (
                  <>
                    <h3 className="panel-sub-title">Done when</h3>
                    <ul className="memory-list">{task.acceptance_criteria.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </>
                )}
              </section>
            )}

            <section aria-label="Activity" className="task-section">
              <h3 className="panel-sub-title">Activity</h3>
              <form className="task-inline" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) void act('tasks/comment', { text: comment }).then((ok) => ok && setComment('')); }}>
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment..." aria-label="Comment" />
                <button type="submit" className="btn btn-primary" disabled={busy || !comment.trim()}>Comment</button>
              </form>
              <ol className="task-activity">
                {[...task.activity].reverse().map((entry, i) => (
                  <li key={i}><span className="memory-date">{entry.at.slice(0, 16).replace('T', ' ')}</span> <b>{entry.actor}</b> {entry.text}</li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}
