import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderConfig } from '../config.js';
import type { ProviderAdapter } from './types.js';

export function createGeminiAdapter(config: ProviderConfig): ProviderAdapter {
  const provider = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return {
    name: 'Google Gemini',
    model: (id: string) => provider(id),
    models: () => [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ],
  };
}
