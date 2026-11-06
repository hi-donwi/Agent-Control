import type { LanguageModel } from 'ai';

/** A model object. `LanguageModel` also admits a global model id string, which we never use. */
export type ChatModel = Exclude<LanguageModel, string>;
