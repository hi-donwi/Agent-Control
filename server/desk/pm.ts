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

// ── Writes, each one `ws` command with the revision the desk read ─────────────────────

/** The task changed since the desk showed it: reload and decide again. */
export class PmConflictError extends Error {}

const REVISION_RE = /^mtime:\d+:size:\d+$/;
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const KINDS = new Set(['task', 'milestone', 'reminder']);
const RECURS = new Set(['daily', 'weekly', 'monthly']);
const ASSIGNEE_RE = /^(agent:)?[a-z0-9][a-z0-9_.-]*$/;
const MOMENT_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
const TITLE_MAX = 120;
const TEXT_MAX = 1000;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export interface PmResult {
  id: string;
  status: string;
  revision: string;
}

function line(value: unknown, what: string, max: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new Error(`${what} is empty`);
  if (text.length > max) throw new Error(`${what} is longer than ${max} characters`);
  return text;
}

function taskId(value: unknown): string {
  if (typeof value !== 'string' || !TASK_ID_RE.test(value)) throw new Error('invalid task id');
  return value;
}

function revisionArgs(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' || !REVISION_RE.test(value)) throw new Error('reload the task before changing it');
  return ['--revision', value];
}

function strings(value: unknown, check: (item: string) => boolean, what: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && check(item))) throw new Error(`invalid ${what}`);
  return value as string[];
}

/** `task <id> <status> <revision>`, the line every `ws task` write prints. */
async function write(run: WsInputRunner, args: string[], input = ''): Promise<PmResult> {
  let output: string;
  try {
    output = await run(args, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/revision mismatch/.test(message)) throw new PmConflictError('this task changed since it was shown; it has been reloaded');
    throw err;
  }
  const reported = stripAnsi(output).split('\n').map((l) => l.trim()).find((l) => l.startsWith('task '));
  const [, id = '', status = '', revision = ''] = (reported ?? '').split(' ');
  if (!id) throw new Error(`ws ${args.slice(0, 2).join(' ')} did not report the task`);
  return { id, status, revision };
}

export async function pmAddTask(run: WsInputRunner, request: Record<string, unknown>): Promise<PmResult> {
  const target = scope(request.scope);
  const title = line(request.title, 'the title', TITLE_MAX);
  const priority = typeof request.priority === 'string' && request.priority ? request.priority : 'normal';
  if (!PRIORITIES.has(priority)) throw new Error(`unknown priority '${priority}'`);
  const args = ['task', 'add', target, title, '--priority', priority];
  if (request.due) {
    if (typeof request.due !== 'string' || !DATE_RE.test(request.due)) throw new Error('the due date is YYYY-MM-DD');
    args.push('--due', request.due);
  }
  if (request.assignee) {
    if (typeof request.assignee !== 'string' || !ASSIGNEE_RE.test(request.assignee)) throw new Error('invalid assignee');
    args.push('--assignee', request.assignee);
  }
  for (const label of strings(request.labels, (l) => KEY_RE.test(l), 'label')) args.push('--label', label);
  if (request.parent) args.push('--parent', taskId(request.parent));
  if (request.kind) {
    if (typeof request.kind !== 'string' || !KINDS.has(request.kind)) throw new Error('invalid kind');
    args.push('--kind', request.kind);
  }
  const description = typeof request.description === 'string' ? request.description.replace(/\r\n?/g, '\n') : '';
  if (CONTROL_RE.test(description)) throw new Error('the description contains control characters');
  if (description.length > 20_000) throw new Error('the description is too long');
  return write(run, [...args, '-'], description);
}

const EDIT_SCALARS: Array<[string, string]> = [
  ['title', '--title'], ['priority', '--priority'], ['due', '--due'], ['assignee', '--assignee'],
  ['parent', '--parent'], ['remind_at', '--remind-at'], ['recur', '--recur'], ['kind', '--kind'],
];

/** Changes fields; `none` clears a scalar. */
export async function pmEditTask(run: WsInputRunner, request: Record<string, unknown>): Promise<PmResult> {
  const args = ['task', 'edit', scope(request.scope), taskId(request.id)];
  const changes = (request.changes ?? {}) as Record<string, unknown>;
  for (const [field, flag] of EDIT_SCALARS) {
    const value = changes[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`invalid ${field}`);
    const ok = value === 'none' && field !== 'title' && field !== 'priority'
      // `none` clears a field in ws, so it can never be a title.
      || (field === 'title' && value.trim().length > 0 && value.trim() !== 'none' && value.length <= TITLE_MAX && !CONTROL_RE.test(value))
      || (field === 'priority' && PRIORITIES.has(value))
      || (field === 'due' && DATE_RE.test(value))
      || (field === 'assignee' && ASSIGNEE_RE.test(value))
      || (field === 'parent' && TASK_ID_RE.test(value))
      || (field === 'remind_at' && MOMENT_RE.test(value))
      || (field === 'recur' && RECURS.has(value))
      || (field === 'kind' && KINDS.has(value));
    if (!ok) throw new Error(`invalid ${field}`);
    args.push(flag, value);
  }
  if (changes.rank !== undefined) {
    if (!Number.isInteger(changes.rank) || (changes.rank as number) < 0) throw new Error('invalid rank');
    args.push('--rank', String(changes.rank));
  }
  for (const label of strings(changes.labels_add, (l) => KEY_RE.test(l), 'label')) args.push('--label-add', label);
  for (const label of strings(changes.labels_rm, (l) => KEY_RE.test(l), 'label')) args.push('--label-rm', label);
  for (const item of strings(changes.check_add, (i) => i.trim().length > 0 && i.length <= 200 && !CONTROL_RE.test(i), 'checklist item')) args.push('--check-add', item);
  for (const item of strings(changes.accept_add, (i) => i.trim().length > 0 && i.length <= 300 && !CONTROL_RE.test(i), 'criterion')) args.push('--accept-add', item);
  if (args.length === 4) throw new Error('nothing to change');
  return write(run, [...args, ...revisionArgs(request.revision)]);
}

export async function pmSetStatus(run: WsInputRunner, request: Record<string, unknown>): Promise<PmResult> {
  const status = typeof request.status === 'string' ? request.status : '';
  if (!STATUSES.has(status)) throw new Error(`unknown status '${status}'`);
  return write(run, ['task', 'status', scope(request.scope), taskId(request.id), status, ...revisionArgs(request.revision)]);
}

export async function pmComment(run: WsInputRunner, request: Record<string, unknown>): Promise<PmResult> {
  const text = line(request.text, 'the comment', TEXT_MAX);
  return write(run, ['task', 'comment', scope(request.scope), taskId(request.id), text, ...revisionArgs(request.revision)]);
}

export async function pmCheck(run: WsInputRunner, request: Record<string, unknown>): Promise<PmResult> {
  const n = request.n;
  if (!Number.isInteger(n) || (n as number) < 1) throw new Error('a checklist item is a number, from 1');
  return write(run, ['task', 'check', scope(request.scope), taskId(request.id), String(n), ...revisionArgs(request.revision)]);
}

export async function pmBlock(run: WsInputRunner, request: Record<string, unknown>, blocked: boolean): Promise<PmResult> {
  const args = ['task', blocked ? 'block' : 'unblock', scope(request.scope), taskId(request.id)];
  if (blocked) args.push(line(request.reason, 'the reason', 200));
  return write(run, [...args, ...revisionArgs(request.revision)]);
}

export async function pmRemind(run: WsInputRunner, request: Record<string, unknown>): Promise<PmResult> {
  const text = line(request.text, 'the reminder', TITLE_MAX);
  const at = typeof request.at === 'string' ? request.at.trim() : '';
  if (!MOMENT_RE.test(at)) throw new Error('a reminder needs a time, YYYY-MM-DD HH:MM');
  const args = ['remind', scope(request.scope), text, '--at', at.replace('T', ' ')];
  if (request.recur) {
    if (typeof request.recur !== 'string' || !RECURS.has(request.recur)) throw new Error('invalid recur');
    args.push('--recur', request.recur);
  }
  return write(run, args);
}
