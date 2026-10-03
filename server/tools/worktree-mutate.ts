import { editWorktreeFile, writeWorktreeFile } from './worktree-files.js';
import { gate } from './gate.js';

export interface MutateDeps {
  root: string;
  project: string;
  /** The active coding session's worktree - the directory these tools write into. */
  worktree: string;
}

export type MutateResult =
  | { ok: true }
  | { approvalRequired: true; requestId: string; expiresAt: string; message: string }
  | { error: string };

export interface WriteFileInput {
  path: string;
  content: string;
  approvalId?: string;
}

/**
 * Creates or overwrites a file in the coding session's worktree, gated by the
 * project's policy (ADR-0014) and, when required, a local approval (ADR-0020). See
 * gate.ts for the flow every mutating tool shares.
 */
export async function writeFileTool(deps: MutateDeps, input: WriteFileInput): Promise<MutateResult> {
  const outcome = await gate(
    { root: deps.root, project: deps.project, cwd: deps.worktree, action: 'write_file' },
    input.approvalId,
    { path: input.path, content: input.content },
    async () => { await writeWorktreeFile(deps.worktree, input.path, input.content); return { ok: true as const }; },
  );
  if (outcome.ran) return outcome.result;
  if ('approvalRequired' in outcome) return outcome;
  return { error: outcome.error };
}

export interface EditFileInput {
  path: string;
  oldString: string;
  newString: string;
  approvalId?: string;
}

/** Replaces a unique, exact match in a worktree file. Same gating as writeFileTool. */
export async function editFileTool(deps: MutateDeps, input: EditFileInput): Promise<MutateResult> {
  const outcome = await gate(
    { root: deps.root, project: deps.project, cwd: deps.worktree, action: 'edit_file' },
    input.approvalId,
    { path: input.path, oldString: input.oldString, newString: input.newString },
    () => editWorktreeFile(deps.worktree, input.path, input.oldString, input.newString),
  );
  if (!outcome.ran) return 'approvalRequired' in outcome ? outcome : { error: outcome.error };
  return 'error' in outcome.result ? outcome.result : { ok: true };
}
