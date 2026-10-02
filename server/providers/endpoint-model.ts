import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Endpoint } from '../endpoints.js';
import { createMockModel } from './mock.js';
import type { ChatModel } from './types.js';

/**
 * The SDK model for an endpoint's wire protocol.
 *
 * The OpenAI and Anthropic SDKs fall back to OPENAI_API_KEY / ANTHROPIC_API_KEY when no
 * key is given - and would send the operator's key to whichever host this endpoint
 * points at. They always get an explicit value. The compatible client reads no
 * environment, so a keyless local server gets no Authorization header at all.
 */
export function createEndpointModel(endpoint: Endpoint, modelId: string, apiKey?: string): ChatModel {
  switch (endpoint.protocol) {
    case 'mock':
      return createMockModel(modelId);
    case 'openai-chat':
      return createOpenAICompatible({ name: endpoint.name, baseURL: endpoint.baseUrl!, apiKey }).chatModel(modelId);
    case 'openai-responses':
      return createOpenAI({ baseURL: endpoint.baseUrl, apiKey: apiKey ?? 'none' }).responses(modelId);
    case 'anthropic-messages':
      return createAnthropic({ baseURL: endpoint.baseUrl, apiKey: apiKey ?? 'none' })(modelId);
  }
}
