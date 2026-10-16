import { KEY_RE } from './workspace-files.js';
import { reportedLine, type WsInputRunner } from './ws-input.js';

/**
 * Operator tasks from the desk, through `ws task` (Agent-Workspace `<context>/tasks/<key>/`).
 * A run's plan rows are not tasks here: they stay with the run's owner.
 */
export const TASK_STATUSES = ['backlog', 'ready', 'in_progress', 'review', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TASK_TITLE_MAX = 120;
const TASK_ID_RE = /^task_[a-z0-9][a-z0-9_-]*$/;
const REVISION_RE = /^mtime:\d+:size:\d+$/;

/** A status change lost to a newer edit: the caller should reload, not retry blindly. */
export class TaskConflictError extends Error {}

export interface TaskResult {
  id: string;
  status: string;
  revision: string;
}

function project(value: unknown): string {
  if (typeof value !== 'string' || !KEY_RE.test(value)) throw new Error('choose a project for the task');
  return value;
}

function parseResult(output: string): TaskResult {
  const [id = '', status = '', revision = ''] = reportedLine(output, 'task').split(' ');
  if (!TASK_ID_RE.test(id)) throw new Error('ws task did not report the task it wrote');
  return { id, status, revision };
}

export async function addTask(run: WsInputRunner, request: Record<string, unknown>): Promise<TaskResult> {
  const key = project(request.project);
  const title = typeof request.title === 'string' ? request.title.replace(/\s+/g, ' ').trim() : '';
  if (!title) throw new Error('a task needs a title');
  if (title.length > TASK_TITLE_MAX) throw new Error(`the title is longer than ${TASK_TITLE_MAX} characters`);
  const priority = typeof request.priority === 'string' && request.priority ? request.priority : 'normal';
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) throw new Error(`unknown priority '${priority}'`);
  return parseResult(await run(['task', 'add', key, title, '--priority', priority, '-'], ''));
}

export async function setTaskStatus(run: WsInputRunner, request: Record<string, unknown>): Promise<TaskResult> {
  const key = project(request.project);
  const id = typeof request.id === 'string' ? request.id : '';
  if (!TASK_ID_RE.test(id)) throw new Error('choose a task');
  const status = typeof request.status === 'string' ? request.status : '';
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new Error(`unknown status '${status}'`);
  const revision = typeof request.revision === 'string' ? request.revision : '';
  // The desk always sends the revision it showed, so a change it never saw is refused.
  if (!REVISION_RE.test(revision)) throw new Error('reload the tasks before changing one');
  try {
    return parseResult(await run(['task', 'status', key, id, status, '--revision', revision], ''));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/revision mismatch/.test(message)) throw new TaskConflictError('this task changed since it was shown; the list has been reloaded');
    throw err;
  }
}
