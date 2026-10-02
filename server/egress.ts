import type { Endpoint } from './endpoints.js';
import { loadPolicy } from './policy.js';

export { policyPath } from './policy.js';

/**
 * Which endpoints may receive a project's context (Agent-Workspace ADR-0021).
 *
 * The operator policy of ADR-0014, `<workspace>/.local/agent/policies/<project>.json`,
 * may list them: `{ "schema_version": 1, ..., "llm": { "endpoints": ["xai"] } }`.
 * A local endpoint is always allowed - nothing leaves the machine. A remote endpoint is
 * allowed only for a project whose policy names it. A missing, invalid, or
 * other-version policy allows no remote endpoint: fail closed.
 */
export interface EgressDecision {
  allowed: boolean;
  reason: string;
}

/** The project's `llm.endpoints`, or null when the policy does not list any. */
export function loadLlmAllowlist(workspaceRoot: string, project: string): string[] | null {
  const endpoints = loadPolicy(workspaceRoot, project)?.llm?.endpoints;
  return Array.isArray(endpoints) ? endpoints.filter((name): name is string => typeof name === 'string') : null;
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
