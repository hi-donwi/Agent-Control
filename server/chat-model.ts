import type { ChatModel } from './providers/types.js';
import { egressDecision, loadLlmAllowlist } from './egress.js';
import { resolveCredential, type CredentialReaders, type Endpoint } from './endpoints.js';
import { createEndpointModel } from './providers/endpoint-model.js';
import type { ProviderAdapter } from './providers/types.js';

export interface ChatModelRequest {
  provider: string;
  model: string;
  /** The project whose context this chat works with; decides remote egress. */
  project?: string;
}

export interface ChatModelDeps {
  root: string;
  endpoints: Endpoint[];
  adapters: Map<string, ProviderAdapter>;
  env?: CredentialReaders['env'];
  keychain?: CredentialReaders['keychain'];
}

export type ChatModelResult = { model: ChatModel } | { status: 400 | 403; error: string };

/**
 * The model for a chat request. A configured endpoint wins over a legacy provider of
 * the same id, and is checked against the project's egress policy before any request.
 * Legacy providers from ~/.agent-control/config.json are served unchanged.
 */
export function resolveChatModel(request: ChatModelRequest, deps: ChatModelDeps): ChatModelResult {
  const endpoint = deps.endpoints.find((e) => e.name === request.provider);
  if (endpoint) {
    let allowlist: string[] | null = null;
    try {
      if (request.project) allowlist = loadLlmAllowlist(deps.root, request.project);
    } catch (error) {
      return { status: 400, error: (error as Error).message };
    }
    const decision = egressDecision(endpoint, request.project, allowlist);
    if (!decision.allowed) return { status: 403, error: decision.reason };
    try {
      const apiKey = resolveCredential(endpoint.credential, { env: deps.env ?? process.env, keychain: deps.keychain });
      return { model: createEndpointModel(endpoint, request.model, apiKey) };
    } catch (error) {
      return { status: 400, error: `endpoint ${endpoint.name}: ${(error as Error).message}` };
    }
  }
  const adapter = deps.adapters.get(request.provider);
  if (!adapter) {
    return { status: 400, error: `Provider "${request.provider}" is not configured. Add an API key in Settings.` };
  }
  return { model: adapter.model(request.model) };
}
