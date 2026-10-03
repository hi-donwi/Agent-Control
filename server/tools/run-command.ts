import { execFile } from 'node:child_process';
import { gate } from './gate.js';

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
 * (ADR-0014) and, when it requires one, a local approval (ADR-0020). See gate.ts for
 * the classify -> request-or-verify -> run flow this and every other mutating tool uses.
 */
export async function runCommand(deps: RunCommandDeps, input: RunCommandInput): Promise<RunCommandResult> {
  const outcome = await gate(
    { root: deps.root, project: deps.project, cwd: deps.cwd, action: 'run_command' },
    input.approvalId,
    { command: input.command, args: input.args ?? [] },
    () => execute(input.command, input.args ?? [], deps.cwd),
  );
  if (outcome.ran) return outcome.result;
  if ('approvalRequired' in outcome) return outcome;
  return { error: outcome.error };
}
