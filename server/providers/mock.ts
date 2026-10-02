import type { LanguageModelV1 } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';

type CallOptions = Parameters<LanguageModelV1['doGenerate']>[0];

/** Text of the last user message in a prompt. */
function lastUserText(prompt: CallOptions['prompt']): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role === 'user') {
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    }
  }
  return '';
}

/**
 * A deterministic, offline model: it answers `mock(<model>): <last user message>`.
 * Tests and demos exercise the whole chat path with it, and never call a real endpoint.
 */
export function createMockModel(modelId = 'echo'): LanguageModelV1 {
  const reply = (options: CallOptions) => `mock(${modelId}): ${lastUserText(options.prompt)}`;
  const rawCall = { rawPrompt: null, rawSettings: {} };
  return new MockLanguageModelV1({
    provider: 'mock',
    modelId,
    doGenerate: async (options) => {
      const text = reply(options);
      return { text, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: text.length }, rawCall };
    },
    doStream: async (options) => {
      const text = reply(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const word of text.split(/(?<= )/)) controller.enqueue({ type: 'text-delta', textDelta: word });
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: text.length } });
            controller.close();
          },
        }),
        rawCall,
      };
    },
  });
}
