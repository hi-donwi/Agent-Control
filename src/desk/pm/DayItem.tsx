import { useState } from 'react';
import { HandGlyph } from '../room/glyphs';
import type { AlertKind, PmAlert } from './types';

const KIND_LABEL: Record<AlertKind, string> = {
  approval: 'needs you', agent: 'raised a hand', overdue: 'overdue', reminder: 'reminder',
  due_today: 'due today', review: 'review', blocked: 'blocked', stale: 'stalled',
};

const SNOOZES: Array<[string, string]> = [['1h', '1 hour'], ['1d', 'tomorrow'], ['1w', 'next week']];

interface Props {
  item: PmAlert;
  onOpenScope: (scope: string) => void;
  onAssistant: (scope: string) => void;
  onSnooze: (id: string, length: string) => Promise<void>;
  compact?: boolean;
}

/**
 * One thing that waits: a person waiting on an approval or a raised hand, or a task that is
 * late, due, stalled, or reminding. Open goes where it can be acted on; snooze hides it for a
 * while, on this machine only.
 */
export function DayItem({ item, onOpenScope, onAssistant, onSnooze, compact = false }: Props) {
  const [error, setError] = useState('');
  const person = item.kind === 'approval' || item.kind === 'agent';
  const snooze = (length: string) => {
    if (!length) return;
    onSnooze(item.id, length).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <li className={`day-item is-${item.severity}${compact ? ' is-compact' : ''}`} aria-label={`${KIND_LABEL[item.kind]}: ${item.title}`}>
      <span className="day-mark" aria-hidden="true">{person ? <HandGlyph /> : <i />}</span>
      <div className="day-body">
        <p className="day-title">{item.title}</p>
        <p className="day-meta">
          <span className={`day-kind kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
          <span className="chip">{item.scope}</span>
          {item.client && !item.scope.startsWith('@') && <span className="chip chip-client">{item.client}</span>}
          <span>{item.detail}</span>
        </p>
        {error && <p className="board-error" role="alert">[ERROR] {error}</p>}
      </div>
      <div className="day-actions">
        <button type="button" className={`btn${person ? ' btn-primary' : ''}`}
          onClick={() => (person ? onAssistant(item.scope) : onOpenScope(item.scope))}>
          Open
        </button>
        {!person && (
          <select aria-label={`Snooze ${item.title}`} value="" onChange={(event) => snooze(event.target.value)}>
            <option value="">Snooze</option>
            {SNOOZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        )}
      </div>
    </li>
  );
}
