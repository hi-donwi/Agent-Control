import { useMemo, useState, type DragEvent } from 'react';
import { apiFetch } from '../../lib/api';
import { AgentFigure } from '../floor/AgentFigure';
import { HandBack } from '../drawers/HandBack';
import { HandGlyph, StationGlyph } from './glyphs';
import { STATIONS, canAssign, canMove, cardsFrom, holdActions, holdRequest, moveRequest, releaseRequest, type Card, type HoldMode, type StationId } from './stations';
import type { useCodingSession } from '../../hooks/useCodingSession';
import type { ProjectDetail } from '../types';

interface Props {
  detail: ProjectDetail;
  coding?: ReturnType<typeof useCodingSession>;
  onChanged: () => void;
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** Shipped work stays visible, but only the latest few. */
const SHIPPED_SHOWN = 6;

const HOLD_LABEL: Record<HoldMode, string> = { block: 'Block', drop: 'Drop' };
const HOLD_PROMPT: Record<HoldMode, string> = { block: 'What blocks it?', drop: 'Why drop it?' };

/**
 * Work as it moves through an agent's day. Cards are operator tasks (`ws task`) and the
 * plan steps of open runs (`ws plan`); dragging a card, or choosing a station from its
 * menu, moves it through `ws` with the revision it was read at. A blocked card raises its
 * hand and says why; blocking a card, or dropping a step, asks for the reason first.
 */
export function MissionBoard({ detail, coding, onChanged }: Props) {
  const cards = useMemo(() => cardsFrom(detail), [detail]);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [holding, setHolding] = useState<{ key: string; mode: HoldMode } | null>(null);
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

  const assign = async (card: Card) => {
    if (!coding) return;
    const sess = await coding.start({ brief: card.title, cardKey: card.key });
    if (sess) {
      move(card, 'hands');
    }
  };

  const add = () => {
    if (!title.trim()) { setError('a task needs a title'); return; }
    void run('desk/tasks', { project: detail.key, title, priority }).then(() => setTitle(''));
  };

  const hold = (card: Card, mode: HoldMode) => {
    if (!reason.trim()) { setError(mode === 'drop' ? 'say why the step is dropped' : 'say what blocks it'); return; }
    const { path, body } = holdRequest(card, mode, reason, detail.key);
    void run(path, body).then(() => { setHolding(null); setReason(''); });
  };

  const release = (card: Card) => {
    const { path, body } = releaseRequest(card, detail.key);
    void run(path, body);
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
                {shown.map((card) => {
                  const isReviewTarget = Boolean(
                    card.station === 'review' &&
                    coding?.session &&
                    (coding.session.cardKey
                      ? coding.session.cardKey === card.key
                      : here.find((c) => c.station === 'review')?.key === card.key)
                  );

                  return (
                    <li
                      key={card.key}
                      className={`mission mission-${card.kind} priority-${card.priority}${card.blocked ? ' is-blocked' : ''}${dragging?.key === card.key ? ' is-dragging' : ''}`}
                      draggable={!holding}
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

                      {canAssign(card) && (
                        <div className="mission-assign">
                          <button
                            type="button"
                            className="btn btn-primary mission-assign-btn"
                            disabled={coding?.busy || (Boolean(coding?.session) && coding?.session?.cardKey !== card.key)}
                            onClick={() => void assign(card)}
                          >
                            Assign to agent
                          </button>
                        </div>
                      )}

                      {card.station === 'hands' && (
                        <div className="mission-in-hands">
                          <div className="mission-agent-working">
                            <AgentFigure
                              state={card.blocked ? 'waiting' : 'typing'}
                              tool={detail.agents[0]?.tool || 'agent-control'}
                              size={44}
                            />
                            <div className="mission-agent-info">
                              <span className="mission-agent-label">
                                {card.blocked ? 'Waiting for input' : 'Working on this task...'}
                              </span>
                              {coding?.session && (
                                <span className="mission-agent-branch">
                                  <code>{coding.session.branch}</code>
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm mission-review-btn"
                            onClick={() => move(card, 'review')}
                          >
                            Ready for review
                          </button>
                        </div>
                      )}

                      {isReviewTarget && coding && (
                        <div className="mission-handback-panel">
                          <HandBack coding={coding} onShipped={() => move(card, 'shipped')} />
                        </div>
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
                        {card.blocked && (
                          <button type="button" className="mission-link" onClick={() => release(card)}>Unblock</button>
                        )}
                        {holdActions(card).map((mode) => (
                          <button key={mode} type="button" className="mission-link" onClick={() => { setHolding({ key: card.key, mode }); setReason(''); }}>
                            {HOLD_LABEL[mode]}
                          </button>
                        ))}
                      </div>
                      {holding?.key === card.key && (
                        <form className="mission-block" onSubmit={(event) => { event.preventDefault(); hold(card, holding.mode); }}>
                          <input
                            aria-label={holding.mode === 'drop' ? `Why drop ${card.title}` : `What blocks ${card.title}`}
                            placeholder={HOLD_PROMPT[holding.mode]}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            autoFocus
                          />
                          <button type="submit" className="btn">{HOLD_LABEL[holding.mode]}</button>
                          <button type="button" className="mission-link" onClick={() => setHolding(null)}>Cancel</button>
                        </form>
                      )}
                    </li>
                  );
                })}
                {here.length === 0 && <li className="station-empty" aria-hidden="true">nothing here</li>}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}
