import { requestApproval, sha256Hex, verifyAndConsume } from '../approvals.js';
import { headSha } from '../git-head.js';
import { classifyAction, policyHash } from '../policy.js';

export interface GateDeps {
  root: string;
  project: string;
  /** Where an approval's revision is read from: the coding session's worktree when one is active, else the project's folder in the primary checkout. */
  cwd: string;
  action: string;
}

export type GateOutcome<T> =
  | { ran: true; result: T }
  | { ran: false; approvalRequired: true; requestId: string; expiresAt: string; message: string }
  | { ran: false; error: string };

/**
 * The classify, then request-or-verify, then run flow every mutating tool uses
 * (ADR-0014, ADR-0020) - one implementation, so a new mutating tool cannot add a
 * subtly different, incorrect gate by hand.
 *
 * `inputForHash` is whatever uniquely identifies this call; it is hashed, never stored
 * or logged in full, so an approval record never carries the client data a tool's
 * arguments might hold.
 */
export async function gate<T>(
  deps: GateDeps,
  approvalId: string | undefined,
  inputForHash: unknown,
  run: () => Promise<T>,
): Promise<GateOutcome<T>> {
  const decision = classifyAction(deps.root, deps.project, deps.action);
  if (decision.decision === 'incomplete') {
    return { ran: false, error: `cannot classify this action: ${decision.reason}` };
  }
  if (decision.decision === 'allow') {
    return { ran: true, result: await run() };
  }

  const sha = await headSha(deps.cwd);
  if (!sha) return { ran: false, error: 'this folder is not a git repository: an approval cannot be bound to a revision' };
  const context = {
    project: deps.project,
    headSha: sha,
    action: deps.action,
    inputHash: sha256Hex(JSON.stringify(inputForHash)),
    policyHash: policyHash(deps.root, deps.project),
  };

  if (approvalId) {
    const verified = verifyAndConsume(deps.root, approvalId, context);
    if (!verified.ok) return { ran: false, error: `approval ${approvalId}: ${verified.reason}` };
    return { ran: true, result: await run() };
  }

  const request = requestApproval(deps.root, context);
  return {
    ran: false,
    approvalRequired: true,
    requestId: request.id,
    expiresAt: request.expiresAt,
    message: `This action needs the operator's approval. Ask them to approve request ${request.id} `
      + `in Agent-Control, then call this tool again with the same arguments and approvalId "${request.id}". `
      + `Do not retry without it - the request will not execute on its own.`,
  };
}
