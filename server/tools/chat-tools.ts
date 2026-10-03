import { isAbsolute, join, normalize, sep } from 'node:path';
import { jsonSchema, type Tool } from 'ai';
import type { WorkspaceBridge } from './workspace.js';
import { runCommand } from './run-command.js';
import { editFileTool, writeFileTool } from './worktree-mutate.js';
import { gitDiff, readWorktreeFile } from './worktree-files.js';

/** A chat bound to one project (ADR-0011): what its tools may reach. */
export interface ChatScope {
  root: string;
  project: string;
  /** The project's folder, relative to the workspace root. */
  folder: string;
  /** The model is remote: host diagnostics do not leave the machine. */
  remote: boolean;
  /**
   * The active coding session's worktree (Agent-Workspace ADR-0019), when one exists.
   * write_file/edit_file/git_diff operate here, never the primary checkout. read_file
   * and search_code still read the primary checkout, not this worktree's edits - until
   * that gap closes, tell the model to use git_diff, not read_file, to see its own work.
   */
  worktree?: string;
}

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
export function createChatTools(bridge: WorkspaceBridge, scope?: ChatScope): Record<string, Tool> {
  const tools: Record<string, PlainTool> = {
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
  };
  return withJsonSchema(scope ? bindToProject(tools, scope) : tools);
}

/**
 * The tools of a chat bound to one project. Nothing lists or reads another project,
 * so a remote model allowed for this project receives only this project's material.
 */
/** Workspace-root-relative paths read_file may reach: the project's own folder, its memory and runs, and the framework. */
function allowedReadPaths(scope: ChatScope): string[] {
  return [scope.folder, `context/memory/projects/${scope.project}`, `context/runs/${scope.project}`, '.agents', 'docs', 'AGENTS.md'];
}

/** True when `rel` (workspace-root-relative, already validated) is scope.folder or inside it. */
function underProjectFolder(scope: ChatScope, rel: string): boolean {
  return rel === scope.folder || rel.startsWith(scope.folder + sep);
}

/** `rel`'s position under scope.folder, as a path relative to it - "" for scope.folder itself. */
function relativeToFolder(scope: ChatScope, rel: string): string {
  return rel === scope.folder ? '' : rel.slice(scope.folder.length + 1);
}

/**
 * read_file prefers the coding session's worktree for a path under the project's own
 * folder - the chat's own edits, not the unedited primary checkout. Framework and
 * memory/run paths are untouched: a coding session never changes those, so they always
 * come from the primary checkout. bridge.readProjectFile() refuses any `.local/` path on
 * purpose, so a worktree read goes through readWorktreeFile() instead, never the bridge.
 */
function readFileTool(tool: PlainTool, scope: ChatScope, inside: (path: unknown, prefixes: string[]) => string): PlainTool {
  const allowed = allowedReadPaths(scope);
  return {
    ...tool,
    execute: async (a: never) => {
      const rel = inside((a as { path: unknown }).path, allowed);
      if (scope.worktree && underProjectFolder(scope, rel)) {
        return { content: await readWorktreeFile(scope.worktree, relativeToFolder(scope, rel)) };
      }
      return tool.execute({ path: rel } as never);
    },
  };
}

/** search_code searches the worktree in place of the project folder, once a coding session is active - same reasoning as readFileTool. */
function searchCodeTool(tool: PlainTool, scope: ChatScope, inside: (path: unknown, prefixes: string[]) => string): PlainTool {
  return {
    ...tool,
    execute: async (a: never) => {
      const { query, folder: requested } = a as { query: string; folder?: string };
      const rel = inside(requested ?? scope.folder, [scope.folder]);
      const folder = scope.worktree ? join(scope.worktree, relativeToFolder(scope, rel)) : rel;
      return tool.execute({ query, folder } as never);
    },
  };
}

function bindToProject(tools: Record<string, PlainTool>, scope: ChatScope): Record<string, PlainTool> {
  const inside = (path: unknown, prefixes: string[]): string => {
    const relative = typeof path === 'string' ? normalize(path) : '';
    if (!relative || isAbsolute(relative) || relative.startsWith('..')
        || !prefixes.some((prefix) => relative === prefix || relative.startsWith(prefix + sep))) {
      throw new Error(`${String(path)} is outside project ${scope.project}`);
    }
    return relative;
  };
  const own = (key: unknown) => {
    if (key !== scope.project) throw new Error(`this chat is bound to ${scope.project}`);
    return key;
  };
  const wrap = <A extends Record<string, unknown>>(tool: PlainTool, adapt: (args: A) => A): PlainTool => ({
    ...tool,
    execute: async (args: never) => tool.execute(adapt(args as A) as never),
  });
  const {
    list_projects: _list, project_tree: _tree, diagnose_database, diagnose_infra, ...rest
  } = tools;
  return {
    ...rest,
    ...(scope.remote ? {} : { diagnose_database, diagnose_infra }),
    context_pack: wrap(tools.context_pack, (a) => ({ ...a, projectKey: own(a.projectKey) })),
    scan_security: wrap(tools.scan_security, (a) => ({ ...a, projectKey: own(a.projectKey) })),
    route_skills: wrap(tools.route_skills, (a) => ({ ...a, projectKey: scope.project })),
    read_file: readFileTool(tools.read_file, scope, inside),
    search_code: searchCodeTool(tools.search_code, scope, inside),
    run_command: {
      description: 'Run a shell command in the project\'s own folder (or its coding session\'s worktree, if '
        + 'one is active). A project\'s operator policy decides whether this runs immediately or needs the '
        + 'operator\'s approval first (Agent-Workspace ADR-0014/0020); if it does, this returns a request id '
        + 'instead of running - relay it to the person and call this again with the same command and approvalId '
        + 'once they approve it. Never retry without it.',
      parameters: {
        properties: {
          command: { type: 'string', description: 'The program to run, e.g. "npm" or "git" - not a shell line' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments, e.g. ["test"]' },
          approvalId: { type: 'string', description: 'The request id from a prior approval-required call, once approved' },
        },
        required: ['command'],
      },
      execute: (a: { command: string; args?: string[]; approvalId?: string }) =>
        runCommand({ root: scope.root, project: scope.project, cwd: scope.worktree ?? join(scope.root, scope.folder) }, a),
    },
    ...(scope.worktree ? codingSessionTools(scope.root, scope.project, scope.worktree) : {}),
  };
}

/**
 * The tools a chat's coding session adds on top of run_command: write, edit, and see a
 * diff of the worktree. Gated the same way as run_command (ADR-0014/0020).
 */
function codingSessionTools(root: string, project: string, worktree: string): Record<string, PlainTool> {
  return {
    write_file: {
      description: 'Create or overwrite a file in the coding session\'s worktree. Gated like run_command: may '
        + 'return a request id instead of writing, needing the operator\'s approval first.',
      parameters: {
        properties: {
          path: { type: 'string', description: 'Path relative to the worktree root' },
          content: { type: 'string', description: 'The file\'s full new content' },
          approvalId: { type: 'string', description: 'The request id from a prior approval-required call, once approved' },
        },
        required: ['path', 'content'],
      },
      execute: (a: { path: string; content: string; approvalId?: string }) => writeFileTool({ root, project, worktree }, a),
    },
    edit_file: {
      description: 'Replace one exact, unique occurrence of oldString with newString in a worktree file. Refused, '
        + 'without writing, if oldString is missing or matches more than once - include more surrounding context '
        + 'and try again. Gated like run_command.',
      parameters: {
        properties: {
          path: { type: 'string', description: 'Path relative to the worktree root' },
          oldString: { type: 'string', description: 'The exact text to replace - must match exactly once' },
          newString: { type: 'string', description: 'Its replacement' },
          approvalId: { type: 'string', description: 'The request id from a prior approval-required call, once approved' },
        },
        required: ['path', 'oldString', 'newString'],
      },
      execute: (a: { path: string; oldString: string; newString: string; approvalId?: string }) => editFileTool({ root, project, worktree }, a),
    },
    git_diff: {
      description: 'Show the coding session\'s current unstaged changes (git diff), optionally scoped to one '
        + 'path. Use this, not read_file or search_code, to see the effect of write_file/edit_file calls so far.',
      parameters: {
        properties: {
          path: { type: 'string', description: 'Optional: scope the diff to one path, relative to the worktree root' },
        },
      },
      execute: async (a: { path?: string }) => ({ content: (await gitDiff(worktree, a.path)) || '(no changes)' }),
    },
  };
}
