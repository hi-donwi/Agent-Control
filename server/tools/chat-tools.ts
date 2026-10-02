import { jsonSchema, type Tool } from 'ai';
import type { WorkspaceBridge } from './workspace.js';

interface PlainTool {
  description: string;
  /** JSON Schema of the arguments; `{}` means no arguments. */
  parameters: Record<string, unknown>;
  execute: (args: never) => Promise<unknown>;
}

/**
 * The AI SDK reads a plain object as a zod schema and throws before the first token,
 * on every request. JSON Schema has to be wrapped in `jsonSchema()`.
 */
function withJsonSchema(tools: Record<string, PlainTool>): Record<string, Tool> {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]): [string, Tool] => [name, {
    description: tool.description,
    inputSchema: jsonSchema({ type: 'object', properties: {}, ...tool.parameters }),
    execute: (input: unknown) => tool.execute(input as never),
  }]));
}

/** The workspace tools offered to the model in /api/chat. */
export function createChatTools(bridge: WorkspaceBridge): Record<string, Tool> {
  return withJsonSchema({
    list_projects: {
      description: 'List all registered projects in the workspace',
      parameters: {},
      execute: async () => {
        const output = await bridge.listProjects();
        return { content: output };
      },
    },
    project_tree: {
      description: 'Show the client > group > project hierarchy',
      parameters: {},
      execute: async () => {
        const output = await bridge.tree();
        return { content: output };
      },
    },
    context_pack: {
      description: 'Load the full context pack for a specific project',
      parameters: {
        type: 'object' as const,
        properties: {
          projectKey: {
            type: 'string' as const,
            description: 'The project key to load context for',
          },
        },
        required: ['projectKey'],
      },
      execute: async ({ projectKey }: { projectKey: string }) => {
        const output = await bridge.contextPack(projectKey);
        return { content: output };
      },
    },
    read_file: {
      description: 'Read a file within the workspace (sandboxed to workspace root)',
      parameters: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string' as const,
            description: 'Relative path from workspace root',
          },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }) => {
        const content = await bridge.readProjectFile(path);
        return { content };
      },
    },
    search_code: {
      description: 'Search for a pattern in project files using ripgrep',
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string' as const,
            description: 'Search pattern',
          },
          folder: {
            type: 'string' as const,
            description: 'Optional: restrict search to a project folder',
          },
        },
        required: ['query'],
      },
      execute: async ({ query, folder }: { query: string; folder?: string }) => {
        const output = await bridge.search(query, folder);
        return { content: output };
      },
    },
    route_skills: {
      description: 'Get skill recommendations from the workspace skill catalog for a given task',
      parameters: {
        type: 'object' as const,
        properties: {
          taskDescription: {
            type: 'string' as const,
            description: 'Description of the task to find matching skills for',
          },
          projectKey: {
            type: 'string' as const,
            description: 'Optional project key to search client-specific domain skills as well',
          },
        },
        required: ['taskDescription'],
      },
      execute: async ({ taskDescription, projectKey }: { taskDescription: string; projectKey?: string }) => {
        const output = await bridge.route(taskDescription, projectKey);
        return { content: output };
      },
    },
    get_skill: {
      description: 'Fetch the authoritative instructions and guidelines for a skill from Agent-Skills / .agents/skills (e.g. codebase-onboarding, rest-api-contract, quarkus-service, uidl-runtime)',
      parameters: {
        type: 'object' as const,
        properties: {
          skillName: {
            type: 'string' as const,
            description: 'The name of the skill, e.g. "codebase-onboarding", "rest-api-contract", or "uidl-runtime"',
          },
        },
        required: ['skillName'],
      },
      execute: async ({ skillName }: { skillName: string }) => {
        const content = await bridge.readSkill(skillName);
        return { content };
      },
    },
    diagnose_database: {
      description: 'Inspect PostgreSQL database health, performance, active queries, blocking locks, unused/invalid indexes, or XID wraparound using dbakit (strictly read-only)',
      parameters: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string' as const,
            description: 'The dbakit probe to run: health, diagnose, sessions, locks, indexes, xid, replication, databases, config, rules, version',
          },
          flags: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Optional flags, e.g. ["--unused-min-size=10485760"] or ["--top-tables=10"]',
          },
        },
        required: ['command'],
      },
      execute: async ({ command, flags }: { command: string; flags?: string[] }) => {
        const output = await bridge.dbakit(command, flags);
        return { content: output };
      },
    },
    diagnose_infra: {
      description: 'Inspect Linux host, Docker, Swarm, and Kubernetes infrastructure diagnostics using opskit (strictly read-only)',
      parameters: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string' as const,
            description: 'The opskit command: diag, audit, net, metrics, explain, version',
          },
          target: {
            type: 'string' as const,
            description: 'Optional target subsystem: host, docker, swarm, k8s, sec',
          },
          flags: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Optional CLI flags',
          },
        },
        required: ['command'],
      },
      execute: async ({ command, target, flags }: { command: string; target?: string; flags?: string[] }) => {
        const output = await bridge.opskit(command, target, flags);
        return { content: output };
      },
    },
    scan_security: {
      description: 'Run security scanner and policy verification across a workspace project using agent-secure (ws scan)',
      parameters: {
        type: 'object' as const,
        properties: {
          projectKey: {
            type: 'string' as const,
            description: 'The project key to run security audit against',
          },
          doctor: {
            type: 'boolean' as const,
            description: 'Set to true to verify scanner installations without running a full scan',
          },
          policy: {
            type: 'string' as const,
            description: 'Optional custom policy file path',
          },
        },
        required: ['projectKey'],
      },
      execute: async ({ projectKey, doctor, policy }: { projectKey: string; doctor?: boolean; policy?: string }) => {
        const output = await bridge.agentSecure(projectKey, { doctor, policy });
        return { content: output };
      },
    },
  });
}
