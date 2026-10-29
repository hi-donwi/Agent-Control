import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useScopedChat, type ScopedConversationSnapshot } from '../useScopedChat';

export type FanoutChatState = ReturnType<typeof useScopedChat> & { scope: string };

interface Props {
  scope: string;
  initialSnapshot: ScopedConversationSnapshot | null;
  onChange: (state: FanoutChatState) => void;
  onPersist: (snapshot: ScopedConversationSnapshot) => void;
}

/** Owns one project's existing scoped conversation while that project is a fan-out recipient. */
export function FanoutChatWorker({ scope, initialSnapshot, onChange, onPersist }: Props) {
  const chat = useScopedChat(scope, initialSnapshot);
  const latest = useRef(chat);
  latest.current = chat;

  const send = useCallback((message: string, provider: string, model: string) =>
    latest.current.send(message, provider, model), []);
  const stopStreaming = useCallback(() => latest.current.stopStreaming(), []);
  const state = useMemo<FanoutChatState>(() => ({
    scope,
    messages: chat.messages,
    isStreaming: chat.isStreaming,
    error: chat.error,
    sendMessage: chat.sendMessage,
    stopStreaming,
    clearMessages: chat.clearMessages,
    setMessages: chat.setMessages,
    send,
    newConversation: chat.newConversation,
    openConversation: chat.openConversation,
    snapshotFor: chat.snapshotFor,
    adoptSnapshot: chat.adoptSnapshot,
    conversationId: chat.conversationId,
    loading: chat.loading,
  }), [
    chat.adoptSnapshot, chat.clearMessages, chat.conversationId, chat.error, chat.isStreaming,
    chat.loading, chat.messages, chat.newConversation, chat.openConversation, chat.sendMessage,
    chat.setMessages, chat.snapshotFor, send, stopStreaming,
  ]);
  const snapshot = useMemo<ScopedConversationSnapshot>(() => ({
    scope,
    conversation: chat.conversationId,
    messages: chat.messages,
  }), [chat.conversationId, chat.messages, scope]);

  useEffect(() => {
    onChange(state);
    if (!state.loading && !state.isStreaming) onPersist(snapshot);
  }, [onChange, onPersist, snapshot, state]);

  useEffect(() => () => {
    if (latest.current.isStreaming) latest.current.stopStreaming();
  }, []);

  return null;
}
