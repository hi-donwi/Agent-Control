import { createAnthropic } from '@ai-sdk/anthropic';
import type { ProviderConfig } from '../config.js';
import type { ProviderAdapter } from './types.js';

export function createAnthropicAdapter(config: ProviderConfig): ProviderAdapter {
  const provider = createAnthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return {
    name: 'Anthropic',
    model: (id: string) => provider(id),
    models: () => [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-haiku-20241022',
    ],
  };
}
