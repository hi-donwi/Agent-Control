import type { LanguageModelV1 } from 'ai';

export interface ProviderAdapter {
  /** Human-readable provider name. */
  name: string;
  /** Create a model instance for streaming. */
  model(modelId: string): LanguageModelV1;
  /** List available model IDs. */
  models(): string[];
}
