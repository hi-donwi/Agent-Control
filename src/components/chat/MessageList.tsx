import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../../lib/types';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function MessageList({ messages, isStreaming }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="message-list" role="log" aria-label="Chat messages">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {isStreaming && (
        <div className="message">
          <div className="message-avatar assistant">⚡</div>
          <div className="message-content">
            <div className="streaming-indicator" role="status" aria-label="Generating response">
              <div className="streaming-dots">
                <span /><span /><span />
              </div>
              <span>Thinking...</span>
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
