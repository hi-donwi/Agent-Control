import { execFile } from 'node:child_process';
import { sha256Hex, requestApproval, verifyAndConsume } from '../approvals.js';
import { headSha } from '../git-head.js';
import { classifyAction, policyHash } from '../policy.js';

export interface RunCommandDeps {
  root: string;
  project: string;
  /** Absolute path the command runs in - the chat's project folder, never the workspace root. */
  cwd: string;
}

export interface RunCommandInput {
  command: string;
  args?: string[];
  /** The id a prior approval-required call returned, after the operator approved it. */
  approvalId?: string;
}

export type RunCommandResult =
  | { content: string; exitCode: number }
  | { approvalRequired: true; requestId: string; expiresAt: string; message: string }
  | { error: string };

const MAX_OUTPUT = 32 * 1024;

function execute(command: string, args: string[], cwd: string): Promise<{ content: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 30_000, maxBuffer: MAX_OUTPUT * 2 }, (err, stdout, stderr) => {
      const output = (stdout + stderr).slice(0, MAX_OUTPUT);
      const exitCode = typeof (err as { code?: number })?.code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ content: output || (err ? err.message : '(no output)'), exitCode });
    });
  });
}

/**
 * Runs a command in the chat's project folder, gated by the project's operator policy
 * (ADR-0014) and, when it requires one, a local approval (ADR-0020).
 *
 * `read`/`change`: runs immediately. `approval-required`, no `approvalId` yet: records a
 * request and returns its id instead of running - the model relays this to the person
 * and must not retry blindly. `approval-required` with `approvalId`: re-verifies the
 * exact command, the project's current HEAD, and the current policy against what the
 * operator approved; any difference voids it. An invalid or missing policy is
 * `incomplete`, refused like a denial - never run.
 */
export async function runCommand(deps: RunCommandDeps, input: RunCommandInput): Promise<RunCommandResult> {
  const action = 'run_command';
  const decision = classifyAction(deps.root, deps.project, action);
  if (decision.decision === 'incomplete') {
    return { error: `cannot classify this action: ${decision.reason}` };
  }
  if (decision.decision === 'allow') {
    return execute(input.command, input.args ?? [], deps.cwd);
  }

  const sha = await headSha(deps.cwd);
  if (!sha) return { error: 'the project folder is not a git repository: an approval cannot be bound to a revision' };
  const context = {
    project: deps.project,
    headSha: sha,
    action,
    inputHash: sha256Hex(JSON.stringify({ command: input.command, args: input.args ?? [] })),
    policyHash: policyHash(deps.root, deps.project),
  };

  if (input.approvalId) {
    const result = verifyAndConsume(deps.root, input.approvalId, context);
    if (!result.ok) return { error: `approval ${input.approvalId}: ${result.reason}` };
    return execute(input.command, input.args ?? [], deps.cwd);
  }

  const request = requestApproval(deps.root, context);
  return {
    approvalRequired: true,
    requestId: request.id,
    expiresAt: request.expiresAt,
    message: `This action needs the operator's approval. Ask them to approve request ${request.id} `
      + `in Agent-Control, then call run_command again with the same command and approvalId "${request.id}". `
      + `Do not retry without it - the request will not execute on its own.`,
  };
}
