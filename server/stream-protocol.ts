import type { TextStreamPart, ToolSet } from 'ai';

export interface StreamFinish {
  finishReason: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * Agent-Control's own line protocol, read by src/hooks/useChat.ts. It stays the same
 * whichever AI SDK major produces the stream, so a server upgrade never breaks the UI:
 *
 *   0:"text delta"                          9:{"toolCallId","toolName","args"}
 *   a:{"toolCallId","result"}               e:"error message"
 *   d:{"finishReason","usage":{"inputTokens","outputTokens"}}
 */
export function toLineStream(
  parts: AsyncIterable<TextStreamPart<ToolSet>>,
  onFinish?: (finish: StreamFinish) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const line = (type: string, value: unknown) => encoder.encode(`${type}:${JSON.stringify(value)}\n`);
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const part of parts) {
          switch (part.type) {
            case 'text-delta':
              controller.enqueue(line('0', part.text));
              break;
            case 'tool-call':
              controller.enqueue(line('9', { toolCallId: part.toolCallId, toolName: part.toolName, args: part.input }));
              break;
            case 'tool-result':
              controller.enqueue(line('a', { toolCallId: part.toolCallId, result: part.output }));
              break;
            case 'tool-error':
              controller.enqueue(line('a', { toolCallId: part.toolCallId, result: `error: ${message(part.error)}` }));
              break;
            case 'error':
              controller.enqueue(line('e', message(part.error)));
              break;
            case 'finish':
              onFinish?.({
                finishReason: part.finishReason,
                tokens: {
                  input: part.totalUsage.inputTokens ?? 0,
                  output: part.totalUsage.outputTokens ?? 0,
                  cacheRead: part.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
                  cacheWrite: part.totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
                },
              });
              controller.enqueue(line('d', {
                finishReason: part.finishReason,
                usage: { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens },
              }));
              break;
          }
        }
      } catch (error) {
        controller.enqueue(line('e', message(error)));
      }
      controller.close();
    },
  });
}
