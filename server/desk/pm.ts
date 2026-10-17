import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripAnsi, type WsInputRunner } from './ws-input.js';
import { KEY_RE, contextDir, inside } from './workspace-files.js';

/**
 * Project management for the desk (Agent-Workspace ADR-0024): Today, alerts, tasks across
 * every client, and client dossiers. Every read is `ws ... --json`, so the desk, the CLI, and
 * agents see one implementation; every write goes through `ws` too. The one thing only the
 * desk reads itself is a client's restricted records (contacts, commercial terms): they are
 * the operator's to see and never reach an agent, so no `ws` command prints them.
 */

/** A task's scope: a project key, or `@<client>` for the client's own work. */
export const SCOPE_RE = /^@?[a-z0-9][a-z0-9_-]*$/;
export const TASK_ID_RE = /^task_[a-z0-9][a-z0-9_-]*$/;
const ALERT_ID_RE = /^[a-z_]+:@?[a-z0-9][a-z0-9_-]*:[A-Za-z0-9._-]+$/;
const SNOOZE_RE = /^(\d{1,3}[hdw]|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['backlog', 'ready', 'in_progress', 'review', 'done']);
const RESTRICTED = ['contacts', 'commercial'] as const;

/**
 * `ws` for reads: like the desk's write runner, but a task list across every client can be
 * large, so the output limit is higher.
 */
export function realWsReader(workspaceRoot: string): WsInputRunner {
  const wsBin = join(workspaceRoot, '.agents', 'bin', 'ws');
  return (args, input) => new Promise((resolve, reject) => {
    const child = execFile(wsBin, args, {
      cwd: workspaceRoot,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PAGER: 'cat', WS_AGENT: 'agent-control' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stripAnsi(stderr || err.message).trim().replace(/^(error: |workspace (tasks|pm): )/, '')));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

async function json<T>(run: WsInputRunner, args: string[]): Promise<T> {
  const output = await run(args, '');
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`ws ${args[0]} did not answer with JSON`);
  }
}

function scope(value: unknown, what = 'scope'): string {
  if (typeof value !== 'string' || !SCOPE_RE.test(value)) throw new Error(`invalid ${what}`);
  return value;
}

function clientKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY_RE.test(value)) throw new Error('invalid client');
  return value;
}

export async function pmToday(run: WsInputRunner, filters: { scope?: string; client?: string } = {}) {
  const args = ['today', '--json'];
  if (filters.scope) args.push('--scope', scope(filters.scope));
  if (filters.client) args.push('--client', clientKey(filters.client));
  return json<Record<string, unknown>>(run, args);
}

export async function pmAlerts(run: WsInputRunner, all = false) {
  return json<{ alerts: Array<Record<string, string>> }>(run, ['alerts', '--json', ...(all ? ['--all'] : [])]);
}

export async function snoozeAlert(run: WsInputRunner, request: Record<string, unknown>): Promise<{ id: string }> {
  const id = typeof request.id === 'string' ? request.id : '';
  if (!ALERT_ID_RE.test(id)) throw new Error('invalid alert id');
  if (request.off === true) {
    await run(['alerts', 'snooze', id, '--off'], '');
    return { id };
  }
  const spec = typeof request.for === 'string' ? request.for.trim() : '';
  if (!SNOOZE_RE.test(spec)) throw new Error('snooze for 1h, 1d, 1w, or until "YYYY-MM-DD HH:MM"');
  await run(['alerts', 'snooze', id, '--for', spec], '');
  return { id };
}

export interface TaskFilters {
  scope?: string;
  client?: string;
  status?: string[];
  assignee?: string;
  label?: string;
  kind?: string;
  dueBefore?: string;
}

/** Tasks of one scope, or of every client and project when `scope` is absent. */
export async function pmTasks(run: WsInputRunner, filters: TaskFilters = {}) {
  const args = ['task', 'list', filters.scope ? scope(filters.scope) : '--all', '--json'];
  if (filters.client) args.push('--client', clientKey(filters.client));
  for (const status of filters.status ?? []) {
    if (!STATUSES.has(status)) throw new Error(`unknown status '${status}'`);
    args.push('--status', status);
  }
  if (filters.assignee) {
    if (!/^(agent:)?[a-z0-9][a-z0-9_.-]*$/.test(filters.assignee)) throw new Error('invalid assignee');
    args.push('--assignee', filters.assignee);
  }
  if (filters.label) {
    if (!KEY_RE.test(filters.label)) throw new Error('invalid label');
    args.push('--label', filters.label);
  }
  if (filters.kind) {
    if (!['task', 'milestone', 'reminder'].includes(filters.kind)) throw new Error('invalid kind');
    args.push('--kind', filters.kind);
  }
  if (filters.dueBefore) {
    if (!DATE_RE.test(filters.dueBefore)) throw new Error('invalid date');
    args.push('--due-before', filters.dueBefore);
  }
  return json<{ tasks: Array<Record<string, unknown>> }>(run, args);
}

export async function pmTask(run: WsInputRunner, taskScope: unknown, id: unknown) {
  if (typeof id !== 'string' || !TASK_ID_RE.test(id)) throw new Error('invalid task id');
  return json<Record<string, unknown>>(run, ['task', 'show', scope(taskScope), id, '--json']);
}

/** The clients the workspace knows: every folder under context/clients with a client.md. */
export function clientKeys(root: string): string[] {
  const dir = join(contextDir(root), 'clients');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && KEY_RE.test(entry.name) && existsSync(join(dir, entry.name, 'client.md')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * One client's dossier from `ws client show`, and - for the desk only - the text of its
 * restricted records. Nothing here is ever handed to a chat or an agent tool.
 */
export async function pmClient(root: string, run: WsInputRunner, key: unknown) {
  const client = clientKey(key);
  const dossier = await json<Record<string, unknown>>(run, ['client', 'show', client, '--json']);
  const restricted: Record<string, string | null> = {};
  for (const name of RESTRICTED) {
    const path = inside(contextDir(root), 'clients', client, `${name}.md`);
    restricted[name] = existsSync(path) ? readFileSync(path, 'utf-8') : null;
  }
  return { ...dossier, restrictedText: restricted };
}

/** Every client with its pulse: open and overdue work, alerts, and the last interaction. */
export async function pmClients(root: string, run: WsInputRunner) {
  const keys = clientKeys(root);
  const dossiers: Array<Record<string, unknown>> = await Promise.all(keys.map((key) => json<Record<string, unknown>>(run, ['client', 'show', key, '--json'])
    .catch((err: unknown): Record<string, unknown> => ({ client: key, error: err instanceof Error ? err.message : String(err) }))));
  return {
    clients: dossiers.map((d) => {
      const interactions = Array.isArray(d.interactions) ? d.interactions as Array<{ at: string }> : [];
      const profile = (d.profile ?? {}) as { title?: string; fields?: Record<string, string> };
      return {
        key: d.client,
        name: profile.fields?.['Full name'] || '',
        projects: Array.isArray(d.projects) ? (d.projects as unknown[]).length : 0,
        open: d.open ?? 0,
        overdue: d.overdue ?? 0,
        alerts: d.alerts ?? 0,
        lastInteraction: interactions[0]?.at ?? '',
        ...(d.error ? { error: d.error } : {}),
      };
    }),
  };
}
