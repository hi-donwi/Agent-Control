import type { ChatModel } from './providers/types.js';
import { egressDecision, loadLlmAllowlist } from './egress.js';
import { resolveCredential, type CredentialReaders, type Endpoint, type Locality } from './endpoints.js';
import { createEndpointModel } from './providers/endpoint-model.js';
import type { AppConfig } from './config.js';

export interface ChatModelRequest {
  provider: string;
  model: string;
  /** The project whose context this chat works with; decides remote egress. */
  project?: string;
}

export interface ChatModelDeps {
  root: string;
  endpoints: Endpoint[];
  env?: CredentialReaders['env'];
  keychain?: CredentialReaders['keychain'];
}

export type ChatModelResult = { model: ChatModel; locality: Locality } | { status: 400 | 403; error: string };

/**
 * Chat inference runs only through Agent Brain (docs/specs/agent-brain-routed-sessions.md):
 * Brain owns provider accounts, credentials, and routing, so Agent-Control never calls a
 * provider directly, not even when Brain is down. `mock` answers offline and sends nothing.
 */
export function isChatEndpoint(endpoint: Endpoint): boolean {
  return endpoint.purpose === 'agent-brain' || endpoint.protocol === 'mock';
}

/**
 * The endpoint and model a chat starts with when the client names none: the configured
 * default when it can chat, else the first Agent Brain endpoint, else `mock`.
 */
export function chatDefaults(config: AppConfig, endpoints: Endpoint[]): { provider: string; model: string } {
  const configured = endpoints.find((e) => e.name === config.defaultProvider && isChatEndpoint(e));
  if (configured) return { provider: configured.name, model: config.defaultModel || (configured.models[0] ?? '') };
  const fallback = endpoints.find((e) => e.purpose === 'agent-brain') ?? endpoints.find((e) => e.protocol === 'mock');
  return fallback ? { provider: fallback.name, model: fallback.models[0] ?? '' } : { provider: '', model: '' };
}

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
 * The model for a chat request: an Agent Brain endpoint (or `mock`), checked against the
 * project's egress policy before any request is made.
 */
export function resolveChatModel(request: ChatModelRequest, deps: ChatModelDeps): ChatModelResult {
  const endpoint = deps.endpoints.find((e) => e.name === request.provider);
  if (!endpoint) {
    return {
      status: 400,
      error: `Endpoint "${request.provider}" is not configured. Chat runs through an Agent Brain endpoint `
        + '(purpose "agent-brain") in .local/agent/endpoints.json.',
    };
  }
  if (!isChatEndpoint(endpoint)) {
    return {
      status: 400,
      error: `Endpoint "${endpoint.name}" is not an Agent Brain endpoint. Chat runs only through Agent Brain; `
        + 'provider accounts and keys belong in Brain.',
    };
  }
  const refusal = egressRefusal(endpoint, request, deps.root);
  if (refusal) return refusal;
  try {
    const apiKey = resolveCredential(endpoint.credential, { env: deps.env ?? process.env, keychain: deps.keychain });
    return { model: createEndpointModel(endpoint, request.model, apiKey), locality: endpoint.locality };
  } catch (error) {
    return { status: 400, error: `endpoint ${endpoint.name}: ${(error as Error).message}` };
  }
}
