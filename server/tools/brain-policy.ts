import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../approvals.js';
import type { GateDeps } from './gate.js';

type BrainDecision = 'inactive' | 'allow' | 'ask' | 'deny';
export interface BrainEvaluation { decision: BrainDecision; fingerprint?: string; error?: string }
const TOOLS: Record<string, string> = { run_command: 'shell', write_file: 'write', edit_file: 'edit', read_file: 'read', search_code: 'search', run_subagent: 'subagent' };

function snapshot(path: string): string | undefined {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 96 * 1024) throw new Error('invalid policy file');
    return sha256Hex(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Operator-selected executable; fixed argv, bounded output, no shell. */
export function runBrain(cwd: string, args: string[], maxBuffer = 128 * 1024, binary = process.env.AGENT_BRAIN_BINARY || 'brain'): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { cwd, timeout: 5000, maxBuffer }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

/** Brain may only tighten the workspace gate. Its policy is selected by the operator. */
export async function evaluateBrainPolicy(
  deps: GateDeps,
  input: unknown,
  binary = process.env.AGENT_BRAIN_BINARY || 'brain',
): Promise<BrainEvaluation> {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(deps.project)) return { decision: 'deny', error: 'invalid project key' };
  // Business task mutations retain their existing gate; Brain governs coding tools.
  if (!TOOLS[deps.action]) return { decision: 'inactive' };
  const policy = join(deps.root, '.local', 'agent', 'brain-policies', `${deps.project}.yaml`);
  try {
    const fingerprint = snapshot(policy);
    if (!fingerprint) return { decision: 'inactive' };
    const args = ['agent', 'check', '--root', deps.cwd, '--policy', policy, '--tool', TOOLS[deps.action]];
    if (deps.role) args.push('--role', deps.role);
    const data = input as Record<string, unknown>;
    if (deps.action === 'run_command') {
      if (typeof data.command !== 'string' || (data.args !== undefined && (!Array.isArray(data.args) || !data.args.every((arg) => typeof arg === 'string')))) return { decision: 'deny', error: 'invalid command input' };
      const tokens = [data.command, ...((data.args as string[] | undefined) ?? [])];
      args.push('--command', tokens.map((token) => /^[a-zA-Z0-9_./:@=+-]+$/.test(token) ? token : JSON.stringify(token)).join(' '));
    } else if (deps.action !== 'run_subagent') {
      if (typeof data.path !== 'string') return { decision: 'deny', error: 'invalid path input' };
      args.push('--path', data.path);
    }
    const output = await runBrain(deps.cwd, args, 16 * 1024, binary);
    const result = JSON.parse(output) as Record<string, unknown>;
    if (result.executed !== false || !['allow', 'ask', 'deny'].includes(String(result.decision)) || Object.keys(result).some((key) => !['decision', 'executed'].includes(key))) throw new Error('invalid Brain response');
    if (snapshot(policy) !== fingerprint) throw new Error('Brain policy changed during evaluation');
    return { decision: result.decision as BrainDecision, fingerprint };
  } catch {
    return { decision: 'deny', error: 'Brain policy could not be verified; no action executed' };
  }
}
