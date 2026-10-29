import { useState } from 'react';
import type { ChatMessage } from '../../lib/types';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { CloseIcon } from '../icons';
import { Drawer } from './Drawer';

interface Props {
  scope: string;
  current: ChatMessage;
  candidates: ChatMessage[];
  onClose: () => void;
}

export function ResponseCompareDrawer({ scope, current, candidates, onClose }: Props) {
  const [baselineId, setBaselineId] = useState(candidates[0]?.id ?? '');
  const baseline = candidates.find((message) => message.id === baselineId);

  return (
    <Drawer label={`Compare responses · ${scope}`} wide onClose={onClose}>
      <header className="drawer-head">
        <h2 className="drawer-title">Compare responses<span className="drawer-subtitle"> · {scope}</span></h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close comparison">
          <CloseIcon />
        </button>
      </header>
      <div className="response-comparison-controls">
        <label htmlFor="response-comparison-baseline">Compare current response with</label>
        <select
          id="response-comparison-baseline"
          value={baselineId}
          onChange={(event) => setBaselineId(event.target.value)}
        >
          {candidates.map((message, index) => (
            <option key={message.id} value={message.id}>{responseLabel(message, candidates.length - index)}</option>
          ))}
        </select>
        <p>Read-only comparison within this project conversation.</p>
      </div>
      {baseline ? (
        <div className="response-comparison-grid">
          <article className="response-comparison-pane" aria-label="Current response">
            <h3>Current response</h3>
            <div className="response-comparison-content"><MarkdownRenderer content={current.content} /></div>
          </article>
          <article className="response-comparison-pane" aria-label="Selected earlier response">
            <h3>Earlier response</h3>
            <p className="response-comparison-date">{new Date(baseline.createdAt).toLocaleString()}</p>
            <div className="response-comparison-content"><MarkdownRenderer content={baseline.content} /></div>
          </article>
        </div>
      ) : (
        <p className="response-comparison-empty" role="status">No earlier response is available in this conversation.</p>
      )}
    </Drawer>
  );
}

function responseLabel(message: ChatMessage, ordinal: number): string {
  const excerpt = message.content.replace(/\s+/g, ' ').trim();
  const clipped = excerpt.length > 72 ? `${excerpt.slice(0, 69)}...` : excerpt;
  return `Earlier response ${ordinal} · ${clipped}`;
}
