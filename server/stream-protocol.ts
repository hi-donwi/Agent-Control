import type { TextStreamPart, ToolSet } from 'ai';
import { publicInferenceError } from './inference-errors.js';

export interface StreamFinish {
  /** The model's finish reason, or `abort` when the turn was stopped before it finished. */
  finishReason: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

type Usage = Extract<TextStreamPart<ToolSet>, { type: 'finish' }>['totalUsage'];

const tokensOf = (usage: Usage): StreamFinish['tokens'] => ({
  input: usage.inputTokens ?? 0,
  output: usage.outputTokens ?? 0,
  cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
});

/**
 * Agent-Control's own line protocol, read by src/hooks/useChat.ts. It stays the same
 * whichever AI SDK major produces the stream, so a server upgrade never breaks the UI:
 *
 *   0:"text delta"                          9:{"toolCallId","toolName","args"}
 *   a:{"toolCallId","result"}               e:"error message"
 *   d:{"finishReason","usage":{"inputTokens","outputTokens"}}
 *
 * An `e:` line carries only the sanitized message of server/inference-errors.ts, never the
 * upstream error text.
 *
 * The AI SDK ends a stopped turn with an `abort` part, whether the browser went away or a
 * model-silence timeout fired (both abort the same merged signal). When `clientSignal` - the
 * browser's request signal - has aborted, the turn ends with neither `e:` nor `d:` and
 * `onFinish` reports `abort`. Otherwise it was a timeout: an `e:` line says so and `onFinish`
 * reports `timeout`. Either way `onFinish` carries the usage of the steps that finished.
 *
 * The stream is pulled: the model is read only as fast as the browser reads, and a cancelled
 * response stops reading the source.
 */
export function toLineStream(
  parts: AsyncIterable<TextStreamPart<ToolSet>>,
  onFinish?: (finish: StreamFinish) => void,
  options: { clientSignal?: AbortSignal } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const line = (type: string, value: unknown) => encoder.encode(`${type}:${JSON.stringify(value)}\n`);
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const iterator = parts[Symbol.asyncIterator]();
  // Usage of the steps that finished, for a turn that is stopped before its finish part.
  const stepped = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  /** The line for one part, or undefined when the part has none. */
  const encode = (part: TextStreamPart<ToolSet>): Uint8Array | undefined => {
    switch (part.type) {
      case 'text-delta':
        return line('0', part.text);
      case 'tool-call':
        return line('9', { toolCallId: part.toolCallId, toolName: part.toolName, args: part.input });
      case 'tool-result':
        return line('a', { toolCallId: part.toolCallId, result: part.output });
      case 'tool-error':
        // Host tool failures (scope, path, approval) are the host's own words, already given to the model.
        return line('a', { toolCallId: part.toolCallId, result: `error: ${message(part.error)}` });
      case 'error':
        return line('e', publicInferenceError(part.error).message);
      case 'finish-step': {
        const tokens = tokensOf(part.usage);
        stepped.input += tokens.input;
        stepped.output += tokens.output;
        stepped.cacheRead += tokens.cacheRead;
        stepped.cacheWrite += tokens.cacheWrite;
        return undefined;
      }
      case 'abort': {
        if (options.clientSignal?.aborted) {
          onFinish?.({ finishReason: 'abort', tokens: { ...stepped } });
          return undefined;
        }
        onFinish?.({ finishReason: 'timeout', tokens: { ...stepped } });
        return line('e', publicInferenceError(new DOMException('model silence', 'TimeoutError')).message);
      }
      case 'finish':
        onFinish?.({ finishReason: part.finishReason, tokens: tokensOf(part.totalUsage) });
        return line('d', {
          finishReason: part.finishReason,
          usage: { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens },
        });
      default:
        return undefined;
    }
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
            return;
          }
          const bytes = encode(next.value);
          if (bytes) {
            controller.enqueue(bytes);
            return;
          }
        }
      } catch (error) {
        controller.enqueue(line('e', publicInferenceError(error).message));
        controller.close();
      }
    },
    async cancel() {
      // The browser is gone: stop reading the model. The chat route's abort signal cancels
      // the upstream request itself; this releases whatever wraps the stream.
      try {
        await iterator.return?.();
      } catch {
        // The source failing while it closes changes nothing for a reader that left.
      }
    },
  });
}
