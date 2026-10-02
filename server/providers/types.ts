import type { LanguageModel } from 'ai';

/** A model object. `LanguageModel` also admits a global model id string, which we never use. */
export type ChatModel = Exclude<LanguageModel, string>;

export interface ProviderAdapter {
  /** Human-readable provider name. */
  name: string;
  /** Create a model instance for streaming. */
  model(modelId: string): ChatModel;
  /** List available model IDs. */
  models(): string[];
}
