import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Endpoint } from './endpoints.js';

/**
 * Which endpoints may receive a project's context (Agent-Workspace ADR-0021).
 *
 * The operator policy of ADR-0014, `<workspace>/.local/agent/policies/<project>.json`,
 * may list them: `{ "schema_version": 1, ..., "llm": { "endpoints": ["xai"] } }`.
 * A local endpoint is always allowed - nothing leaves the machine. A remote endpoint is
 * allowed only for a project whose policy names it. A missing, invalid, or
 * other-version policy allows no remote endpoint: fail closed.
 */
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

export interface EgressDecision {
  allowed: boolean;
  reason: string;
}

export function policyPath(workspaceRoot: string, project: string): string {
  if (!KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  return join(workspaceRoot, '.local', 'agent', 'policies', `${project}.json`);
}

/** The project's `llm.endpoints`, or null when the policy does not list any. */
export function loadLlmAllowlist(workspaceRoot: string, project: string): string[] | null {
  const path = policyPath(workspaceRoot, project);
  if (!existsSync(path)) return null;
  try {
    const policy = JSON.parse(readFileSync(path, 'utf-8')) as { schema_version?: unknown; llm?: { endpoints?: unknown } };
    const endpoints = policy?.llm?.endpoints;
    if (policy?.schema_version !== 1 || !Array.isArray(endpoints)) return null;
    return endpoints.filter((name): name is string => typeof name === 'string');
  } catch {
    return null;
  }
}

export function egressDecision(endpoint: Endpoint, project: string | undefined, allowlist: string[] | null): EgressDecision {
  if (endpoint.locality === 'local') {
    return { allowed: true, reason: `${endpoint.name} is local; nothing leaves this machine` };
  }
  if (!project) {
    return { allowed: false, reason: `${endpoint.name} is remote: choose a project whose policy lists it` };
  }
  if (allowlist?.includes(endpoint.name)) {
    return { allowed: true, reason: `${project} policy lists ${endpoint.name}` };
  }
  return {
    allowed: false,
    reason: `${endpoint.name} is remote and not in llm.endpoints of .local/agent/policies/${project}.json`,
  };
}
