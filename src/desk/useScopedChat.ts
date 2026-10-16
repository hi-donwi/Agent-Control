import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../hooks/useChat';
import { apiFetch } from '../lib/api';
import type { ChatMessage, ToolCallResult } from '../lib/types';

/** The history scope of a chat bound to no project (server/conversations.ts). */
const WORKSPACE_SCOPE = '_workspace';

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; status: ToolCallResult['status'] | 'pending'; result?: string }>;
  at: string;
}

interface Parked {
  conversation: string;
  messages: ChatMessage[];
}

function newId(): string {
  return crypto.randomUUID();
}

function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
  return stored.map((m, index) => ({
    id: `history-${index}-${m.at}`,
    role: m.role,
    content: m.content,
    createdAt: Date.parse(m.at) || Date.now(),
    ...(m.toolCalls ? {
      toolCalls: m.toolCalls.map((call) => ({ name: call.name, args: {}, result: call.result, status: call.status === 'error' ? 'error' : 'done' })),
    } : {}),
  }));
}

/**
 * One conversation per scope ('' is the workspace, otherwise a project key). Switching
 * scope stops a running turn, parks the conversation, and shows the new scope's - so a
 * project's messages are never sent to an endpoint allowed only for another (ADR-0021).
 * The first time a scope is opened its latest conversation is loaded from the host's
 * history, so a reload keeps it; every turn is written back under the same id.
 */
export function useScopedChat(scope: string) {
  const chat = useChat();
  const parked = useRef(new Map<string, Parked>());
  const current = useRef<string | null>(null);
  const conversation = useRef(newId());
  const latest = useRef(chat);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    latest.current = chat;
  });

  useEffect(() => {
    if (current.current === scope) return;
    const live = latest.current;
    if (current.current !== null) {
      if (live.isStreaming) live.stopStreaming();
      parked.current.set(current.current, { conversation: conversation.current, messages: live.messages });
    }
    current.current = scope;
    // clearMessages also drops the previous scope's error; a restore lands after it.
    live.clearMessages();
    const restored = parked.current.get(scope);
    if (restored) {
      conversation.current = restored.conversation;
      live.setMessages(restored.messages);
      // A load still running for the scope we just left must not keep this one waiting.
      setLoading(false);
      return;
    }
    conversation.current = newId();
    setLoading(true);
    // No cleanup flag: StrictMode runs this effect twice and the second run returns early
    // above, so a flag would discard the only fetch. A result for a scope that is no
    // longer current is ignored instead.
    apiFetch<{ id: string | null; messages: StoredMessage[] }>(`conversations/latest?scope=${encodeURIComponent(scope || WORKSPACE_SCOPE)}`)
      .then((found) => {
        if (current.current !== scope || !found.id) return;
        conversation.current = found.id;
        latest.current.setMessages(toChatMessages(found.messages));
      })
      .catch(() => { /* no history: start a fresh conversation */ })
      .finally(() => { if (current.current === scope) setLoading(false); });
  }, [scope]);

  const send = useCallback((content: string, provider: string, model: string) => {
    latest.current.sendMessage(content, provider, model, scope || undefined, conversation.current);
  }, [scope]);

  /** Starts a new conversation in this scope; the old one stays in the history. */
  const newConversation = useCallback(() => {
    conversation.current = newId();
    latest.current.clearMessages();
  }, []);

  return { ...chat, send, newConversation, loading };
}
