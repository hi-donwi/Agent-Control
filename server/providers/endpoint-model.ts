import type { LanguageModelV1 } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { Endpoint } from '../endpoints.js';
import { createMockModel } from './mock.js';

/**
 * The SDK model for an endpoint's wire protocol.
 *
 * The key is always passed explicitly. Left undefined, both SDKs fall back to
 * OPENAI_API_KEY / ANTHROPIC_API_KEY from the environment - and would send the
 * operator's OpenAI key to whichever compatible vendor this endpoint points at.
 */
export function createEndpointModel(endpoint: Endpoint, modelId: string, apiKey?: string): LanguageModelV1 {
  const key = apiKey ?? 'none';
  switch (endpoint.protocol) {
    case 'mock':
      return createMockModel(modelId);
    case 'openai-chat':
      return createOpenAI({ baseURL: endpoint.baseUrl, apiKey: key, compatibility: 'compatible' }).chat(modelId);
    case 'openai-responses':
      return createOpenAI({ baseURL: endpoint.baseUrl, apiKey: key }).responses(modelId);
    case 'anthropic-messages':
      return createAnthropic({ baseURL: endpoint.baseUrl, apiKey: key })(modelId);
  }
}
