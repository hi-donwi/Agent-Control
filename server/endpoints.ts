import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LLM endpoints configured by wire protocol, not by vendor (Agent-Workspace ADR-0021).
 *
 * A vendor, router, or local server that speaks one of these protocols is added in
 * `<workspace>/.local/agent/endpoints.json` - configuration, not code:
 *
 *   { "endpoints": { "xai": { "protocol": "openai-chat", "baseUrl": "https://api.x.ai/v1",
 *                             "apiKey": "env:XAI_API_KEY", "models": ["..."] } } }
 *
 * `apiKey` is a reference (`env:NAME` or `keychain:NAME`), never the key itself.
 * `mock` is a deterministic, offline model for tests and demos.
 */
export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'mock';
export type Locality = 'local' | 'remote';

export interface Endpoint {
  name: string;
  protocol: Protocol;
  baseUrl?: string;
  /** `env:NAME` or `keychain:NAME`. */
  credential?: string;
  locality: Locality;
  models: string[];
}

const PROTOCOLS: readonly Protocol[] = ['openai-chat', 'openai-responses', 'anthropic-messages', 'mock'];
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const CREDENTIAL_RE = /^(env|keychain):[A-Za-z0-9_.-]+$/;

export class EndpointConfigError extends Error {}

export function endpointsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.local', 'agent', 'endpoints.json');
}

/**
 * Derived, never declared: a config file that could call any host `local` would switch
 * off default-deny with one word. Loopback is local; a LAN host is remote.
 */
export function localityOf(baseUrl: string): Locality {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)) {
    return 'local';
  }
  return 'remote';
}

export function parseEndpoints(raw: unknown): Endpoint[] {
  const entries = (raw as { endpoints?: unknown } | null)?.endpoints;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new EndpointConfigError('endpoints.json must hold an "endpoints" object');
  }
  return Object.entries(entries as Record<string, Record<string, unknown>>).map(([name, value]) => {
    if (!NAME_RE.test(name)) {
      throw new EndpointConfigError(`endpoint name '${name}' must be lowercase letters, digits, '-' or '_'`);
    }
    const protocol = value?.protocol as Protocol;
    if (!PROTOCOLS.includes(protocol)) {
      throw new EndpointConfigError(`endpoint '${name}': protocol must be one of ${PROTOCOLS.join(', ')}`);
    }
    const apiKey = value.apiKey;
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !CREDENTIAL_RE.test(apiKey))) {
      // Never echo the value: if it is a key, this message would publish it.
      throw new EndpointConfigError(
        `endpoint '${name}': apiKey must be a reference (env:NAME or keychain:NAME), never a literal key`);
    }
    const models = Array.isArray(value.models) ? value.models.filter((m): m is string => typeof m === 'string') : [];
    if (protocol === 'mock') {
      return { name, protocol, locality: 'local', models };
    }
    const baseUrl = value.baseUrl;
    if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
      throw new EndpointConfigError(`endpoint '${name}': baseUrl must be an http(s) URL`);
    }
    return { name, protocol, baseUrl, credential: apiKey as string | undefined, locality: localityOf(baseUrl), models };
  });
}

/** Endpoints from `<workspace>/.local/agent/endpoints.json`; none when the file is absent. */
export function loadEndpoints(workspaceRoot: string): Endpoint[] {
  const path = endpointsPath(workspaceRoot);
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    throw new EndpointConfigError(`${path} is not valid JSON`);
  }
  return parseEndpoints(raw);
}

export interface CredentialReaders {
  env: Record<string, string | undefined>;
  keychain?: (service: string) => string;
}

/** macOS Keychain generic password, read with execFile (no shell). */
function readKeychain(service: string): string {
  return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf-8' }).trim();
}

/** The secret a reference points at. Errors name the reference, never a value. */
export function resolveCredential(
  ref: string | undefined,
  readers: CredentialReaders = { env: process.env },
): string | undefined {
  if (!ref) return undefined;
  const [kind, name] = ref.split(':', 2);
  if (kind === 'env') {
    const value = readers.env[name];
    if (!value) throw new EndpointConfigError(`${name} is not set`);
    return value;
  }
  try {
    return (readers.keychain ?? readKeychain)(name);
  } catch {
    throw new EndpointConfigError(`keychain item '${name}' could not be read`);
  }
}
