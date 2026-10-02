import { MockLanguageModelV4 } from 'ai/test';
import type { ChatModel } from './types.js';

interface PromptMessage {
  role: string;
  content: unknown;
}

/** Text of the last user message in a prompt. */
function lastUserText(prompt: readonly PromptMessage[]): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const { role, content } = prompt[i];
    if (role === 'user' && Array.isArray(content)) {
      return content.map((part: { type?: string; text?: string }) => (part.type === 'text' ? part.text ?? '' : '')).join('');
    }
  }
  return '';
}

function usage(outputTokens: number) {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  };
}

const STOP = { unified: 'stop' as const, raw: undefined };

/**
 * A deterministic, offline model: it answers `mock(<model>): <last user message>`.
 * Tests and demos exercise the whole chat path with it, and never call a real endpoint.
 */
export function createMockModel(modelId = 'echo'): ChatModel {
  const reply = (prompt: readonly PromptMessage[]) => `mock(${modelId}): ${lastUserText(prompt)}`;
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId,
    doGenerate: async ({ prompt }) => {
      const text = reply(prompt);
      return { content: [{ type: 'text', text }], finishReason: STOP, usage: usage(text.length), warnings: [] };
    },
    doStream: async ({ prompt }) => {
      const text = reply(prompt);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't0' });
            for (const word of text.split(/(?<= )/)) controller.enqueue({ type: 'text-delta', id: 't0', delta: word });
            controller.enqueue({ type: 'text-end', id: 't0' });
            controller.enqueue({ type: 'finish', finishReason: STOP, usage: usage(text.length) });
            controller.close();
          },
        }),
      };
    },
  });
}
