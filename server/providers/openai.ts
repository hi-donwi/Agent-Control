import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderConfig } from '../config.js';
import type { ProviderAdapter } from './types.js';

export function createOpenAIAdapter(config: ProviderConfig): ProviderAdapter {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return {
    name: 'OpenAI',
    model: (id: string) => provider(id),
    models: () => [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o3',
      'o3-mini',
      'o4-mini',
    ],
  };
}
