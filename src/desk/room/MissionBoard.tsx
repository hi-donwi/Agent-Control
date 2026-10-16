import { useMemo, useState, type DragEvent } from 'react';
import { apiFetch } from '../../lib/api';
import { HandGlyph, StationGlyph } from './glyphs';
import { STATIONS, canMove, cardsFrom, moveRequest, type Card, type StationId } from './stations';
import type { ProjectDetail } from '../types';

interface Props {
  detail: ProjectDetail;
  onChanged: () => void;
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** Shipped work stays visible, but only the latest few. */
const SHIPPED_SHOWN = 6;

/**
 * Work as it moves through an agent's day. Cards are operator tasks (`ws task`) and the
 * plan steps of open runs (`ws plan`); dragging a card, or choosing a station from its
 * menu, moves it through `ws` with the revision it was read at. A blocked card raises its
 * hand and says why.
 */
export function MissionBoard({ detail, onChanged }: Props) {
  const cards = useMemo(() => cardsFrom(detail), [detail]);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [blocking, setBlocking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');

  const run = async (path: string, body: Record<string, string>) => {
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      onChanged();
    }
  };

  const move = (card: Card, to: StationId) => {
    if (!canMove(card, to)) return;
    const { path, body } = moveRequest(card, to, detail.key);
    void run(path, body);
  };

  const add = () => {
    if (!title.trim()) { setError('a task needs a title'); return; }
    void run('desk/tasks', { project: detail.key, title, priority }).then(() => setTitle(''));
  };

  const block = (card: Card) => {
    if (!reason.trim()) { setError('say what blocks the task'); return; }
    void run('desk/tasks/block', { project: detail.key, id: card.ref, reason, revision: card.revision })
      .then(() => { setBlocking(null); setReason(''); });
  };

  const drop = (event: DragEvent, to: StationId) => {
    event.preventDefault();
    if (dragging) move(dragging, to);
    setDragging(null);
  };

  return (
    <section className="board" aria-label="Mission board">
      {error && <p className="board-error" role="alert">[ERROR] {error}</p>}
      <div className="board-stations">
        {STATIONS.map((station) => {
          const here = cards.filter((card) => card.station === station.id);
          const shown = station.id === 'shipped' ? here.slice(-SHIPPED_SHOWN) : here;
          const valid = dragging ? canMove(dragging, station.id) : false;
          return (
            <section
              key={station.id}
              className={`station station-${station.id}${valid ? ' is-target' : ''}${dragging && !valid && dragging.station !== station.id ? ' is-closed' : ''}`}
              aria-label={`${station.label}, ${here.length}`}
              onDragOver={(event) => { if (valid) event.preventDefault(); }}
              onDrop={(event) => drop(event, station.id)}
            >
              <header className="station-head">
                <span className="station-glyph"><StationGlyph id={station.id} /></span>
                <span className="station-name">{station.label}</span>
                <span className="station-count">{here.length}</span>
              </header>
              <p className="station-hint">{station.hint}</p>

              {station.id === 'queue' && (
                <form className="mission-new" onSubmit={(event) => { event.preventDefault(); add(); }}>
                  <input aria-label="New mission" placeholder="New mission..." value={title} onChange={(event) => setTitle(event.target.value)} />
                  <select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button type="submit" className="btn">Add</button>
                </form>
              )}

              <ol className="station-cards">
                {shown.map((card) => (
                  <li
                    key={card.key}
                    className={`mission mission-${card.kind} priority-${card.priority}${card.blocked ? ' is-blocked' : ''}${dragging?.key === card.key ? ' is-dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragging(card)}
                    onDragEnd={() => setDragging(null)}
                    aria-label={`${card.kind === 'task' ? 'Task' : 'Run step'}: ${card.title}${card.blocked ? `, blocked: ${card.reason}` : ''}`}
                  >
                    <p className="mission-title">{card.title}</p>
                    <p className="mission-meta">
                      {card.kind === 'step' ? <span className="mission-run">run step {card.ref} · {card.runTitle}</span> : <span className="mission-priority">{card.priority}</span>}
                      {card.station === 'hands' && <span className="mission-busy" aria-hidden="true"><i /><i /><i /></span>}
                    </p>
                    {card.blocked && (
                      <p className="mission-blocked"><HandGlyph /><span>{card.reason || 'blocked'}</span></p>
                    )}
                    <div className="mission-actions">
                      <select
                        aria-label={`Move ${card.title}`}
                        value=""
                        onChange={(event) => move(card, event.target.value as StationId)}
                      >
                        <option value="">Move to...</option>
                        {STATIONS.filter((s) => canMove(card, s.id)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      {card.kind === 'task' && (card.blocked ? (
                        <button type="button" className="mission-link" onClick={() => void run('desk/tasks/unblock', { project: detail.key, id: card.ref, revision: card.revision })}>
                          Unblock
                        </button>
                      ) : (
                        <button type="button" className="mission-link" onClick={() => { setBlocking(card.key); setReason(''); }}>
                          Block
                        </button>
                      ))}
                    </div>
                    {blocking === card.key && (
                      <form className="mission-block" onSubmit={(event) => { event.preventDefault(); block(card); }}>
                        <input aria-label={`What blocks ${card.title}`} placeholder="What blocks it?" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
                        <button type="submit" className="btn">Block</button>
                        <button type="button" className="mission-link" onClick={() => setBlocking(null)}>Cancel</button>
                      </form>
                    )}
                  </li>
                ))}
                {here.length === 0 && <li className="station-empty" aria-hidden="true">nothing here</li>}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}
