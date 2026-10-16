import { KEY_RE } from './workspace-files.js';
import { reportedLine, type WsInputRunner } from './ws-input.js';

/**
 * A run's plan row from the desk, through `ws plan status --operator` (Agent-Workspace):
 * `ws` checks that the person at the desk owns the run, that one row at most is in
 * progress, and that the plan has not changed since the desk showed it.
 */
export const PLAN_STATUSES = ['pending', 'in_progress', 'done', 'blocked', 'dropped'] as const;
const RUN_RE = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;
const ROW_RE = /^\d+[a-z]?$/;
const REVISION_RE = /^mtime:\d+:size:\d+$/;

/** The plan changed since the desk showed it: reload, do not retry blindly. */
export class PlanConflictError extends Error {}

export async function setPlanStatus(run: WsInputRunner, request: Record<string, unknown>) {
  const project = typeof request.project === 'string' ? request.project : '';
  if (!KEY_RE.test(project)) throw new Error('choose a project');
  const runId = typeof request.run === 'string' ? request.run : '';
  if (!RUN_RE.test(runId)) throw new Error('choose a run');
  const row = typeof request.n === 'string' ? request.n : String(request.n ?? '');
  if (!ROW_RE.test(row)) throw new Error('choose a plan row');
  const status = typeof request.status === 'string' ? request.status : '';
  if (!(PLAN_STATUSES as readonly string[]).includes(status)) throw new Error(`unknown status '${status}'`);
  const revision = typeof request.revision === 'string' ? request.revision : '';
  if (!REVISION_RE.test(revision)) throw new Error('reload the plan before changing a row');
  const notes = typeof request.notes === 'string' ? request.notes : undefined;

  const args = ['plan', 'status', project, runId, row, status, '--revision', revision, '--operator'];
  if (notes !== undefined) args.push('--notes', notes);
  let output: string;
  try {
    output = await run(args, '');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/revision mismatch/.test(message)) throw new PlanConflictError('this plan changed since it was shown; it has been reloaded');
    throw new Error(message.replace(/^(error: |plan: )/, ''));
  }
  const [reportedRun = '', reportedRow = '', reportedStatus = '', reportedRevision = ''] = reportedLine(output, 'plan').split(' ');
  if (reportedRun !== runId || reportedRow !== row) throw new Error('ws plan did not report the row it changed');
  return { run: reportedRun, n: reportedRow, status: reportedStatus, revision: reportedRevision };
}
