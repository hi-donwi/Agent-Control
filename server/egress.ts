import type { Endpoint } from './endpoints.js';
import { loadPolicy, type BrainProfileGrant } from './policy.js';

export { policyPath } from './policy.js';

/**
 * Which endpoints may receive a project's context (Agent-Workspace ADR-0021).
 *
 * The operator policy of ADR-0014, `<workspace>/.local/agent/policies/<project>.json`,
 * may list them under `llm.endpoints`. Agent-Brain endpoints additionally require an
 * exact `llm.brain_profiles` grant for the configured profile ID/revision.
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
  return Array.isArray(endpoints) ? endpoints : null;
}

/** The project's exact Agent-Brain profile revision grants, or null when none are listed. */
export function loadBrainProfileAllowlist(workspaceRoot: string, project: string): BrainProfileGrant[] | null {
  return loadPolicy(workspaceRoot, project)?.llm?.brain_profiles ?? null;
}

export function egressDecision(
  endpoint: Endpoint,
  project: string | undefined,
  allowlist: string[] | null,
  brainProfiles: BrainProfileGrant[] | null = null,
): EgressDecision {
  if (endpoint.locality === 'local') {
    return { allowed: true, reason: `${endpoint.name} is local; nothing leaves this machine` };
  }
  if (!project) {
    return { allowed: false, reason: `${endpoint.name} is remote: choose a project whose policy lists it` };
  }
  if (allowlist?.includes(endpoint.name)) {
    if (endpoint.purpose === 'agent-brain') {
      const profile = endpoint.routingProfile;
      if (!profile || !brainProfiles?.some((grant) => grant.endpoint === endpoint.name
        && grant.profile_id === profile.id && grant.revision === profile.revision)) {
        return {
          allowed: false,
          reason: `${endpoint.name} requires an exact routing profile revision in llm.brain_profiles of .local/agent/policies/${project}.json`,
        };
      }
    }
    return { allowed: true, reason: `${project} policy lists ${endpoint.name}` };
  }
  return {
    allowed: false,
    reason: `${endpoint.name} is remote and not in llm.endpoints of .local/agent/policies/${project}.json`,
  };
}
