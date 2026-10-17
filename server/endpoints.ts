import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * LLM endpoints configured by wire protocol, not by vendor (Agent-Workspace ADR-0021).
 *
 * A vendor, router, or local server that speaks one of these protocols is added in
 * `<workspace>/.local/agent/endpoints.json` - configuration, not code:
 *
 *   { "endpoints": { "xai": { "protocol": "openai-chat", "baseUrl": "https://api.x.ai/v1",
 *                             "apiKey": "env:XAI_API_KEY", "models": ["..."] } } }
 *
 * `apiKey` is a reference (`env:NAME`, `keychain:NAME`, or `file:PATH` for a token file
 * readable only by its owner, such as Agent-Brain's `~/.lokal/serve.token`), never the
 * key itself. `mock` is a deterministic, offline model for tests and demos.
 *
 * `"locality": "remote"` marks a loopback endpoint that forwards elsewhere - a gateway or
 * router such as Agent-Brain serving cloud accounts - so a project's context reaches it
 * only when that project's policy lists it. It can only tighten: declaring a remote URL
 * `local` is refused.
 */
export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'mock';
export type Locality = 'local' | 'remote';

export interface Endpoint {
  name: string;
  protocol: Protocol;
  baseUrl?: string;
  /** `env:NAME`, `keychain:NAME`, or `file:PATH`. */
  credential?: string;
  locality: Locality;
  models: string[];
}

const PROTOCOLS: readonly Protocol[] = ['openai-chat', 'openai-responses', 'anthropic-messages', 'mock'];
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const CREDENTIAL_RE = /^(?:(?:env|keychain):[A-Za-z0-9_.-]+|file:(?:~\/|\/)[A-Za-z0-9_.~/-]+)$/;

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
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !CREDENTIAL_RE.test(apiKey) || apiKey.split('/').includes('..'))) {
      // Never echo the value: if it is a key, this message would publish it.
      throw new EndpointConfigError(
        `endpoint '${name}': apiKey must be a reference (env:NAME, keychain:NAME, or file:/absolute/path), never a literal key`);
    }
    const models = Array.isArray(value.models) ? value.models.filter((m): m is string => typeof m === 'string') : [];
    if (protocol === 'mock') {
      return { name, protocol, locality: 'local', models };
    }
    const baseUrl = value.baseUrl;
    if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
      throw new EndpointConfigError(`endpoint '${name}': baseUrl must be an http(s) URL`);
    }
    const derived = localityOf(baseUrl);
    const declared = value.locality;
    if (declared !== undefined && declared !== 'remote' && !(declared === 'local' && derived === 'local')) {
      throw new EndpointConfigError(`endpoint '${name}': locality can only be declared "remote"; a remote URL is never local`);
    }
    const locality: Locality = declared === 'remote' ? 'remote' : derived;
    return { name, protocol, baseUrl, credential: apiKey as string | undefined, locality, models };
  });
}

import { detectLokalEndpoint } from './lokal.js';
export { detectLokalEndpoint };

/** Endpoints from `<workspace>/.local/agent/endpoints.json`; none when the file is absent. */
export function loadEndpoints(
  workspaceRoot: string,
  opts?: { autoDiscoverLokal?: boolean; home?: string },
): Endpoint[] {
  const path = endpointsPath(workspaceRoot);
  let list: Endpoint[] = [];
  if (existsSync(path)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      throw new EndpointConfigError(`${path} is not valid JSON`);
    }
    list = parseEndpoints(raw);
  }
  if (opts?.autoDiscoverLokal) {
    const lokal = detectLokalEndpoint(opts.home);
    if (lokal && !list.some((e) => e.name === 'lokal')) {
      list.push(lokal);
    }
  }
  return list;
}

export interface CredentialReaders {
  env: Record<string, string | undefined>;
  keychain?: (service: string) => string;
  /** Home directory for `file:~/...` references; the user's by default. */
  home?: string;
}

/** A token file's contents, refused unless only its owner can read it. */
function readCredentialFile(ref: string, path: string): string {
  if (!existsSync(path)) throw new EndpointConfigError(`credential file for '${ref}' does not exist`);
  if ((statSync(path).mode & 0o077) !== 0) {
    throw new EndpointConfigError(`credential file for '${ref}' must be readable only by its owner (chmod 600)`);
  }
  return readFileSync(path, 'utf-8').trim();
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
  if (kind === 'file') {
    const path = name.startsWith('~/') ? join(readers.home ?? homedir(), name.slice(2)) : name;
    if (!isAbsolute(path)) throw new EndpointConfigError(`credential file for '${ref}' must be an absolute path`);
    return readCredentialFile(ref, path);
  }
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
