import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../hooks/useChat';
import { apiFetch } from '../lib/api';
import { buildEvidenceMetadata } from '../lib/evidence';
import type { ChatMessage, ToolCallResult } from '../lib/types';

/** The history scope of a chat bound to no project (server/conversations.ts). */
const WORKSPACE_SCOPE = '_workspace';

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ id?: string; name: string; status: ToolCallResult['status']; result?: string }>;
  at: string;
}

interface Parked {
  conversation: string;
  messages: ChatMessage[];
}

export interface ScopedConversationSnapshot extends Parked {
  scope: string;
}

function newId(): string {
  return crypto.randomUUID();
}

function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
  return stored.map((m, index) => {
    const toolCalls = m.toolCalls?.map((call) => ({
      id: call.id,
      name: call.name,
      args: {},
      result: call.result,
      status: call.status === 'error' ? 'error' : call.status,
    })) as ToolCallResult[] | undefined;
    return {
      id: `history-${index}-${m.at}`,
      role: m.role,
      content: m.content,
      createdAt: Date.parse(m.at) || Date.now(),
      ...(toolCalls ? { toolCalls, evidence: buildEvidenceMetadata(toolCalls) } : {}),
    };
  });
}

/**
 * One conversation per scope ('' is the workspace, otherwise a project key). Switching
 * scope stops a running turn, parks the conversation, and shows the new scope's - so a
 * project's messages are never sent to an endpoint allowed only for another (ADR-0021).
 * The first time a scope is opened its latest conversation is loaded from the host's
 * history, so a reload keeps it; every turn is written back under the same id.
 */
export function useScopedChat(scope: string, initialSnapshot?: ScopedConversationSnapshot | null) {
  const chat = useChat();
  const parked = useRef(new Map<string, Parked>());
  const current = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const conversation = useRef(newId());
  const latest = useRef(chat);
  const initial = useRef(initialSnapshot);
  const [loading, setLoading] = useState(true);
  /** The conversation on screen, for the history list to mark. */
  const [conversationId, setConversationId] = useState(conversation.current);

  useEffect(() => {
    latest.current = chat;
  });

  useEffect(() => {
    if (current.current === scope) return;
    const generation = ++loadGeneration.current;
    const live = latest.current;
    if (current.current !== null) {
      if (live.isStreaming) live.stopStreaming();
      parked.current.set(current.current, { conversation: conversation.current, messages: live.messages });
    }
    current.current = scope;
    // clearMessages also drops the previous scope's error; a restore lands after it.
    live.clearMessages();
    const restored = parked.current.get(scope)
      ?? (initial.current?.scope === scope ? initial.current : undefined);
    initial.current = null;
    if (restored) {
      conversation.current = restored.conversation;
      setConversationId(restored.conversation);
      live.setMessages(restored.messages);
      // A load still running for the scope we just left must not keep this one waiting.
      setLoading(false);
      return;
    }
    conversation.current = newId();
    setConversationId(conversation.current);
    setLoading(true);
    // No cleanup flag: StrictMode runs this effect twice and the second run returns early
    // above, so a flag would discard the only fetch. A result for a scope that is no
    // longer current is ignored instead.
    apiFetch<{ id: string | null; messages: StoredMessage[] }>(`conversations/latest?scope=${encodeURIComponent(scope || WORKSPACE_SCOPE)}`)
      .then((found) => {
        if (current.current !== scope || loadGeneration.current !== generation || !found.id) return;
        conversation.current = found.id;
        setConversationId(found.id);
        latest.current.setMessages(toChatMessages(found.messages));
      })
      .catch(() => { /* no history: start a fresh conversation */ })
      .finally(() => {
        if (current.current === scope && loadGeneration.current === generation) setLoading(false);
      });
  }, [scope]);

  const send = useCallback((content: string, provider: string, model: string) => {
    return latest.current.sendMessage(content, provider, model, scope || undefined, conversation.current);
  }, [scope]);

  const snapshotFor = useCallback((targetScope: string): ScopedConversationSnapshot | null => {
    if (current.current === targetScope && loading) return null;
    const snapshot = current.current === targetScope
      ? { conversation: conversation.current, messages: latest.current.messages }
      : parked.current.get(targetScope);
    return snapshot ? { scope: targetScope, ...snapshot } : null;
  }, [loading]);

  const adoptSnapshot = useCallback((snapshot: ScopedConversationSnapshot) => {
    const parkedSnapshot = { conversation: snapshot.conversation, messages: snapshot.messages };
    if (current.current === snapshot.scope) {
      loadGeneration.current++;
      conversation.current = snapshot.conversation;
      setConversationId(snapshot.conversation);
      latest.current.setMessages(snapshot.messages);
      setLoading(false);
    } else {
      parked.current.set(snapshot.scope, parkedSnapshot);
    }
  }, []);

  /** Starts a new conversation in this scope; the old one stays in the history. */
  const newConversation = useCallback(() => {
    loadGeneration.current++;
    conversation.current = newId();
    setConversationId(conversation.current);
    latest.current.clearMessages();
    setLoading(false);
  }, []);

  /**
   * Continues an earlier conversation of this scope: the host answers only for this scope,
   * and the next turn is appended to it.
   */
  const openConversation = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current;
    const live = latest.current;
    if (live.isStreaming) live.stopStreaming();
    setLoading(true);
    try {
      const found = await apiFetch<{ id: string; messages: StoredMessage[] }>(
        `conversations/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope || WORKSPACE_SCOPE)}`,
      );
      if (current.current !== scope || loadGeneration.current !== generation) return;
      conversation.current = found.id;
      setConversationId(found.id);
      live.clearMessages();
      live.setMessages(toChatMessages(found.messages));
    } finally {
      if (current.current === scope && loadGeneration.current === generation) setLoading(false);
    }
  }, [scope]);

  return { ...chat, send, newConversation, openConversation, snapshotFor, adoptSnapshot, conversationId, loading };
}
