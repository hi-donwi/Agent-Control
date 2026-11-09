import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SuiteManifest } from '../src/lib/suite.js';

export interface SuiteReadinessInput {
  workspaceRoot: string;
  brainConfigured: boolean;
  resolveAgentSecure: () => Promise<string>;
}

const WORKSPACE_MARKERS = ['AGENTS.md', join('.agents', 'standards')];
const SKILL_CATALOGS = [join('.agents', 'skills')];

/** Build a local readiness view; it never probes Brain, runs a scan, or returns paths. */
export async function getSuiteManifest(input: SuiteReadinessInput): Promise<SuiteManifest> {
  const [workspaceReady, skillsReady, secureReady] = await Promise.all([
    hasWorkspaceRuntime(input.workspaceRoot),
    hasSkillCatalog(input.workspaceRoot),
    resolvesAgentSecure(input.resolveAgentSecure),
  ]);

  return {
    schemaVersion: 1,
    name: 'Agent Workspace Suite',
    components: [
      {
        id: 'agent-control',
        name: 'Agent-Control',
        role: 'Host, operator UI, and agent tool orchestration',
        distribution: 'bundled application',
        requiredFor: 'all suite features',
        state: 'ready',
        detail: 'This application provides the suite host and desk.',
      },
      {
        id: 'agent-brain',
        name: 'Agent-Brain',
        role: 'Inference, provider accounts, and model routing',
        distribution: 'separate service',
        requiredFor: 'real model inference',
        state: input.brainConfigured ? 'configured' : 'not-configured',
        detail: input.brainConfigured
          ? 'A Brain endpoint is configured. Connectivity and project egress are checked only when inference is requested.'
          : 'Configure an Agent-Brain endpoint to enable real model inference.',
      },
      {
        id: 'agent-workspace',
        name: 'Agent-Workspace',
        role: 'Workspace framework, ws CLI, context, and project lifecycle',
        distribution: 'selected workspace',
        requiredFor: 'project-aware tools and desk records',
        state: workspaceReady ? 'configured' : 'not-configured',
        detail: workspaceReady
          ? 'Framework markers and the ws CLI are present. Workspace doctor was not run.'
          : 'Select a workspace containing the framework markers and ws CLI.',
      },
      {
        id: 'agent-skills',
        name: 'Agent-Skills',
        role: 'Portable skill catalog and reusable agent workflows',
        distribution: 'workspace-synchronized catalog',
        requiredFor: 'authoritative skill retrieval',
        state: skillsReady ? 'configured' : 'not-installed',
        detail: skillsReady
          ? 'Skill catalog files are present. Catalog synchronization was not checked.'
          : 'Sync an Agent-Skills catalog into the selected workspace.',
      },
      {
        id: 'agent-secure',
        name: 'Agent-Secure',
        role: 'Deterministic security gate and scanner report normalizer',
        distribution: 'workspace CLI component',
        requiredFor: 'security scans and CI gates',
        state: secureReady ? 'configured' : 'not-installed',
        detail: secureReady
          ? 'The security CLI is resolvable. Policy and scanner pins are validated when a scan runs.'
          : 'The security gate is unavailable; install or build it before requesting a scan.',
      },
    ],
  };
}

async function hasWorkspaceRuntime(root: string): Promise<boolean> {
  try {
    const markers = await Promise.all(WORKSPACE_MARKERS.map((marker) => stat(join(root, marker))));
    const wsPath = join(root, '.agents', 'bin', 'ws');
    const wsInfo = await stat(wsPath);
    await access(wsPath, constants.X_OK);
    return markers[0].isFile() && markers[1].isDirectory() && wsInfo.isFile();
  } catch {
    return false;
  }
}

async function hasSkillCatalog(root: string): Promise<boolean> {
  for (const catalog of SKILL_CATALOGS) {
    try {
      const entries = await readdir(join(root, catalog), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        try {
          if ((await stat(join(root, catalog, entry.name, 'SKILL.md'))).isFile()) return true;
        } catch {
          // Continue until an installed skill entry point is found.
        }
      }
    } catch {
      // A missing optional catalog is reported as not installed.
    }
  }
  return false;
}

async function resolvesAgentSecure(resolve: () => Promise<string>): Promise<boolean> {
  try {
    return Boolean(await resolve());
  } catch {
    return false;
  }
}
