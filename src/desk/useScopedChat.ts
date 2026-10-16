import { useEffect, useRef } from 'react';
import { useChat } from '../hooks/useChat';
import type { ChatMessage } from '../lib/types';

/**
 * One conversation per scope ('' is the workspace, otherwise a project key). Switching
 * scope stops a running turn, parks the conversation, and restores the new scope's - so
 * each agent's drawer shows its own project's history and a project's messages are never
 * sent to an endpoint allowed only for another (ADR-0021). History lasts while the page
 * is open; server-side history is phase 2.
 */
export function useScopedChat(scope: string) {
  const chat = useChat();
  const parked = useRef(new Map<string, ChatMessage[]>());
  const current = useRef(scope);
  const latest = useRef(chat);

  useEffect(() => {
    latest.current = chat;
  });

  useEffect(() => {
    if (current.current === scope) return;
    const live = latest.current;
    if (live.isStreaming) live.stopStreaming();
    parked.current.set(current.current, live.messages);
    // clearMessages also drops the previous scope's error; the restore lands after it.
    live.clearMessages();
    live.setMessages(parked.current.get(scope) ?? []);
    current.current = scope;
  }, [scope]);

  return chat;
}
