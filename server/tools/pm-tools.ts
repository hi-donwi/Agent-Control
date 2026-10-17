import { join } from 'node:path';
import { gate } from './gate.js';
import type { ChatScope, PlainTool } from './chat-tools.js';
import { pmAddTask, pmCheck, pmComment, pmEditTask, pmSetStatus, pmTasks, pmToday, realWsReader } from '../desk/pm.js';
import { readRegistry } from '../desk/registry.js';
import type { WsInputRunner } from '../desk/ws-input.js';

/**
 * Project management for a chat bound to a project (Agent-Workspace ADR-0024): the same
 * `ws` commands the desk and `ws mcp` use, within the chat's project and its client's own
 * work. Reading is free; every change is the `task_change` action under the project's
 * operator policy (ADR-0014), so the operator decides whether it runs or waits for an
 * approval (ADR-0020). Restricted client records are never returned: no `ws` command prints them.
 */
export const TASK_CHANGE = 'task_change';

/** The fields a model needs to plan with, without each task's whole activity. */
function brief(task: Record<string, unknown>) {
  const { id, title, scope, status, priority, kind, due, assignee, blocked, blocked_reason, checklist, revision, labels } = task;
  return { id, title, scope, status, priority, kind, due, assignee, blocked, blocked_reason, checklist, labels, revision };
}

export function pmTools(scope: ChatScope, run: WsInputRunner = realWsReader(scope.root)): Record<string, PlainTool> {
  const client = readRegistry(scope.root).find((row) => row.key === scope.project)?.client ?? '';
  const scopes = [scope.project, ...(client && client !== '-' ? [`@${client}`] : [])];
  const own = (value: unknown): string => {
    const target = typeof value === 'string' && value ? value : scope.project;
    if (!scopes.includes(target)) throw new Error(`this chat reaches ${scopes.join(' and ')}, not ${target}`);
    return target;
  };
  const gated = async (approvalId: string | undefined, input: unknown, change: () => Promise<unknown>) => {
    const outcome = await gate(
      { root: scope.root, project: scope.project, cwd: scope.worktree ?? join(scope.root, scope.folder), action: TASK_CHANGE },
      approvalId, input, change,
    );
    if (outcome.ran) return outcome.result;
    if ('approvalRequired' in outcome) return outcome;
    return { error: outcome.error };
  };
  const scopeParam = { type: 'string', description: `${scopes.join(' or ')}; defaults to ${scope.project}` };
  const approvalParam = { type: 'string', description: 'The request id from a prior approval-required call, once approved' };

  return {
    list_tasks: {
      description: `List the tasks of ${scope.project} (or its client's own work), ranked, with status, due date, assignee, blocker, checklist, and revision.`,
      parameters: { properties: { scope: scopeParam, status: { type: 'array', items: { type: 'string', enum: ['backlog', 'ready', 'in_progress', 'review', 'done'] } } } },
      execute: async (a: { scope?: string; status?: string[] }) => {
        const { tasks } = await pmTasks(run, { scope: own(a.scope), status: a.status });
        return { tasks: tasks.map(brief) };
      },
    },
    today: {
      description: `What needs doing now in ${scope.project}: overdue and due work, reminders, blocked or stalled tasks, waiting approvals, and work in progress.`,
      parameters: {},
      execute: async () => pmToday(run, { scope: scope.project }),
    },
    add_task: {
      description: `Add a task to the backlog of ${scope.project} or its client. Under the project's policy this may need the operator's approval first; if so, relay the request id and call again with approvalId once approved.`,
      parameters: {
        properties: {
          title: { type: 'string' }, scope: scopeParam, description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, due: { type: 'string', description: 'YYYY-MM-DD' },
          approvalId: approvalParam,
        },
        required: ['title'],
      },
      execute: async (a: { title: string; scope?: string; description?: string; priority?: string; due?: string; approvalId?: string }) => {
        const target = own(a.scope);
        return gated(a.approvalId, { tool: 'add_task', ...a, approvalId: undefined },
          () => pmAddTask(run, { scope: target, title: a.title, description: a.description, priority: a.priority, due: a.due }));
      },
    },
    update_task: {
      description: 'Change a task: move it to a status, comment on it, tick checklist item n, or add checklist items. Pass the revision you read. Gated like add_task.',
      parameters: {
        properties: {
          task_id: { type: 'string' }, scope: scopeParam, revision: { type: 'string' },
          status: { type: 'string', enum: ['backlog', 'ready', 'in_progress', 'review', 'done'] },
          comment: { type: 'string' }, check: { type: 'integer', minimum: 1 },
          add_checklist: { type: 'array', items: { type: 'string' } }, approvalId: approvalParam,
        },
        required: ['task_id'],
      },
      execute: async (a: { task_id: string; scope?: string; revision?: string; status?: string; comment?: string; check?: number; add_checklist?: string[]; approvalId?: string }) => {
        const target = own(a.scope);
        return gated(a.approvalId, { tool: 'update_task', ...a, approvalId: undefined }, async () => {
          // The revision guards the first write; each later one follows the write before it.
          let revision = a.revision;
          const step = async (write: Promise<{ revision: string }>) => { revision = (await write).revision; };
          if (a.add_checklist?.length) await step(pmEditTask(run, { scope: target, id: a.task_id, revision, changes: { check_add: a.add_checklist } }));
          if (a.check) await step(pmCheck(run, { scope: target, id: a.task_id, n: a.check, revision }));
          if (a.status) await step(pmSetStatus(run, { scope: target, id: a.task_id, status: a.status, revision }));
          if (a.comment) await step(pmComment(run, { scope: target, id: a.task_id, text: a.comment, revision }));
          return { id: a.task_id, revision };
        });
      },
    },
    client_profile: {
      description: `The profile of ${scope.project}'s client: what they are, how to work with them, their projects and own open work, and recent interactions. Contacts and commercial terms are never included.`,
      parameters: {},
      execute: async () => {
        if (!client || client === '-') return { error: `${scope.project} has no client` };
        return JSON.parse(await run(['client', 'show', client, '--json'], ''));
      },
    },
  };
}
