import { useState, useCallback, useRef } from 'react';
import { getAuthToken } from '../lib/api';
import type { ChatMessage, ToolCallResult } from '../lib/types';

let messageCounter = 0;
function createId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string, provider: string, model: string) => {
      if (!content.trim() || isStreaming) return;

      setError(null);

      // Add user message
      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: content.trim(),
        createdAt: Date.now(),
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);

      // Create assistant placeholder
      const assistantMsg: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        toolCalls: [],
        createdAt: Date.now(),
      };

      setMessages([...updatedMessages, assistantMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Build messages for the API (only role + content)
        const apiMessages = updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getAuthToken()}`,
          },
          body: JSON.stringify({ messages: apiMessages, provider, model }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Request failed (${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullText = '';
        const toolCalls: ToolCallResult[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;

            // AI SDK data stream protocol
            // 0: text delta
            // 9: tool call start
            // a: tool result
            // e: error
            // d: done
            const type = line[0];
            const data = line.slice(2);

            try {
              if (type === '0') {
                // Text delta — JSON string
                const text = JSON.parse(data) as string;
                fullText += text;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: fullText };
                  }
                  return updated;
                });
              } else if (type === '9') {
                // Tool call
                const tool = JSON.parse(data) as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                toolCalls.push({
                  name: tool.toolName,
                  args: tool.args,
                  status: 'pending',
                });
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, toolCalls: [...toolCalls] };
                  }
                  return updated;
                });
              } else if (type === 'a') {
                // Tool result
                const result = JSON.parse(data) as { toolCallId: string; result: unknown };
                const tc = toolCalls[toolCalls.length - 1];
                if (tc) {
                  tc.result = typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result);
                  tc.status = 'done';
                }
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, toolCalls: [...toolCalls] };
                  }
                  return updated;
                });
              } else if (type === 'e') {
                const errData = JSON.parse(data) as string;
                setError(errData);
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setError(msg);
          // Remove empty assistant message on error
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && !last.content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages,
  };
}
