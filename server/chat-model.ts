import type { ChatModel } from './providers/types.js';
import { egressDecision, loadLlmAllowlist } from './egress.js';
import { localityOf, resolveCredential, type CredentialReaders, type Endpoint, type Locality } from './endpoints.js';
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
  /** Base URLs of legacy providers from ~/.agent-control/config.json, for their locality. */
  legacyBaseUrls?: Record<string, string | undefined>;
}

export type ChatModelResult = { model: ChatModel; locality: Locality } | { status: 400 | 403; error: string };

/** 400 for a bad project key, 403 when the project may not send context to `target`. */
function egressRefusal(target: Endpoint, request: ChatModelRequest, root: string): { status: 400 | 403; error: string } | null {
  let allowlist: string[] | null = null;
  try {
    if (request.project) allowlist = loadLlmAllowlist(root, request.project);
  } catch (error) {
    return { status: 400, error: (error as Error).message };
  }
  const decision = egressDecision(target, request.project, allowlist);
  return decision.allowed ? null : { status: 403, error: decision.reason };
}

/**
 * The model for a chat request. A configured endpoint wins over a legacy provider of
 * the same id. Both are checked against the project's egress policy before any request:
 * a legacy provider is remote unless its base URL is loopback.
 */
export function resolveChatModel(request: ChatModelRequest, deps: ChatModelDeps): ChatModelResult {
  const endpoint = deps.endpoints.find((e) => e.name === request.provider);
  if (endpoint) {
    const refusal = egressRefusal(endpoint, request, deps.root);
    if (refusal) return refusal;
    try {
      const apiKey = resolveCredential(endpoint.credential, { env: deps.env ?? process.env, keychain: deps.keychain });
      return { model: createEndpointModel(endpoint, request.model, apiKey), locality: endpoint.locality };
    } catch (error) {
      return { status: 400, error: `endpoint ${endpoint.name}: ${(error as Error).message}` };
    }
  }
  const adapter = deps.adapters.get(request.provider);
  if (!adapter) {
    return { status: 400, error: `Provider "${request.provider}" is not configured. Add an API key in Settings.` };
  }
  const baseUrl = deps.legacyBaseUrls?.[request.provider];
  const locality = baseUrl ? localityOf(baseUrl) : 'remote';
  const refusal = egressRefusal({ name: request.provider, protocol: 'openai-chat', locality, models: [] }, request, deps.root);
  if (refusal) return refusal;
  return { model: adapter.model(request.model), locality };
}
