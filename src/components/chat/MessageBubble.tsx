import { useState, useCallback } from 'react';
import type { ChatMessage } from '../../lib/types';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className="message">
      <div className={`message-avatar ${message.role}`}>
        {isUser ? 'U' : '✦'}
      </div>
      <div className="message-content">
        <div className="message-role">{isUser ? 'You' : 'Agent Control'}</div>
        <div className="message-body">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : null}
        </div>
        {message.toolCalls?.map((tool, i) => (
          <ToolCallCard key={i} name={tool.name} args={tool.args} result={tool.result} status={tool.status} />
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ name, args, result, status }: {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const displayName = name.replace(/_/g, ' ');
  const argsPreview = Object.values(args).filter(Boolean).join(', ');

  return (
    <div className="tool-call">
      <button
        className="tool-call-header"
        onClick={toggle}
        aria-expanded={expanded}
        type="button"
        style={{ cursor: 'pointer', width: '100%', border: 'none', background: 'transparent', textAlign: 'left' }}
      >
        <span>{status === 'pending' ? '⏳' : status === 'done' ? '✓' : '✗'}</span>
        <span>{displayName}</span>
        {argsPreview && <span style={{ opacity: 0.6, fontWeight: 400, textTransform: 'none' }}>({argsPreview})</span>}
      </button>
      {expanded && result && (
        <div className="tool-call-body">
          <pre><code>{result.slice(0, 2000)}{result.length > 2000 ? '\n...(truncated)' : ''}</code></pre>
        </div>
      )}
    </div>
  );
}
