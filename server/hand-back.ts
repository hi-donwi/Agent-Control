import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { readCodingSession, writeCodingSession, type CodingSession, type VerifyState } from './coding-sessions.js';

/**
 * Handing a coding session's work back (desk phase 4b): verify it where it is, then ship
 * it to the project's main branch or discard it.
 *
 * - Verify runs the operator's contract in the session worktree (`ws verify --worktree`)
 *   and keeps the result with the worktree content it saw, as a git tree id.
 * - Ship pushes only what passed: the worktree must still hold exactly the verified
 *   content, the commit must be a fast-forward of `origin/<main>`, and the push is never
 *   forced. ADR-0019 §7: done is still `ws verify`.
 * - Discard stops the session and removes its worktree and branch - only a worktree
 *   under `.local/worktrees/<key>/`, never any other folder a record names.
 */

export interface WsResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface HandBackDeps {
  /** `ws <args>` with `env` over the ambient environment; resolves on any exit code. */
  ws(args: string[], env: Record<string, string>): Promise<WsResult>;
}

/** The request no longer fits the session's state: reload and decide again. */
export class HandBackConflict extends Error {}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  return git(cwd, args).then(() => true, () => false);
}

function sessionOf(root: string, project: string): CodingSession {
  const session = readCodingSession(root, project);
  if (!session) throw new HandBackConflict('this project has no coding session');
  return session;
}

/**
 * The worktree's whole content - tracked changes and untracked files the ignore rules
 * let through - as a git tree id, written through a copy of its index so the real one is
 * left as it was.
 */
export async function worktreeTree(worktree: string): Promise<string> {
  const indexPath = await git(worktree, ['rev-parse', '--git-path', 'index']);
  const index = isAbsolute(indexPath) ? indexPath : join(worktree, indexPath);
  const dir = mkdtempSync(join(tmpdir(), 'ac-tree-'));
  const scratch = join(dir, 'index');
  try {
    if (existsSync(index)) copyFileSync(index, scratch);
    await git(worktree, ['add', '-A'], { GIT_INDEX_FILE: scratch });
    return await git(worktree, ['write-tree'], { GIT_INDEX_FILE: scratch });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes `change` into the session record, unless the session ended or was replaced meanwhile. */
function update(root: string, project: string, id: string, change: (session: CodingSession) => CodingSession): CodingSession | null {
  const current = readCodingSession(root, project);
  if (!current || current.id !== id) return null;
  const next = change(current);
  writeCodingSession(root, project, next);
  return next;
}

interface VerifyReport {
  status?: string;
  commands?: VerifyState['commands'];
}

/**
 * Starts `ws verify --worktree` for the session and records it as running; `done`
 * settles once the result is recorded. A verify already running is returned as it is.
 */
export async function startVerify(root: string, project: string, deps: HandBackDeps): Promise<{ session: CodingSession; done: Promise<void> }> {
  const session = sessionOf(root, project);
  if (session.verify?.state === 'running') return { session, done: Promise.resolve() };
  const tree = await worktreeTree(session.worktree);
  const running = update(root, project, session.id, (s) => ({ ...s, verify: { state: 'running', tree, startedAt: new Date().toISOString() } }))!;

  const done = (async () => {
    let verify: VerifyState;
    try {
      const result = await deps.ws(['verify', project, '--worktree', session.worktree, '--json'], { WS_SESSION_ID: session.id, WS_AGENT: 'agent-control' });
      let report: VerifyReport | null = null;
      try { report = JSON.parse(result.stdout) as VerifyReport; } catch { /* a refusal prints no report */ }
      const finishedAt = new Date().toISOString();
      if (!report || !['pass', 'findings', 'incomplete'].includes(String(report.status))) {
        const reason = result.stderr.replace(ANSI_RE, '').trim().replace(/^error: /, '') || `ws verify exited with ${result.code}`;
        verify = { state: 'error', tree, startedAt: running.verify!.startedAt, finishedAt, error: reason };
      } else {
        const now = await worktreeTree(session.worktree);
        verify = {
          state: now === tree ? report.status as VerifyState['state'] : 'stale',
          tree,
          startedAt: running.verify!.startedAt,
          finishedAt,
          commands: report.commands ?? [],
        };
      }
    } catch (err) {
      verify = { state: 'error', tree, startedAt: running.verify!.startedAt, finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
    }
    update(root, project, session.id, (s) => ({ ...s, verify }));
  })();
  return { session: running, done };
}

/** `main` for `origin/HEAD -> origin/main`; `main` when the remote names no default. */
async function baseBranch(worktree: string): Promise<string> {
  const ref = await git(worktree, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).catch(() => '');
  return ref.startsWith('origin/') && ref !== 'origin/HEAD' ? ref.slice('origin/'.length) : 'main';
}

/**
 * Pushes the session's verified work to `origin/<main>`: commits what is uncommitted
 * with `message`, then pushes only if that is a fast-forward. Nothing is forced.
 */
export async function shipSession(root: string, project: string, message: string) {
  const session = sessionOf(root, project);
  const verified = session.verify;
  if (!verified || verified.state !== 'pass') throw new HandBackConflict('verify must pass before the work can ship');
  const wt = session.worktree;
  if (await worktreeTree(wt) !== verified.tree) {
    throw new HandBackConflict('the worktree changed since it was verified; verify again');
  }

  if (await git(wt, ['status', '--porcelain'])) {
    const text = message.trim();
    if (!text) throw new Error('a commit needs a message');
    await git(wt, ['add', '-A']);
    await git(wt, ['commit', '-q', '-m', text]);
  }
  const head = await git(wt, ['rev-parse', 'HEAD']);
  if (await git(wt, ['rev-parse', 'HEAD^{tree}']) !== verified.tree) {
    throw new HandBackConflict('the commit does not hold the verified content; verify again');
  }

  const base = await baseBranch(wt);
  await git(wt, ['fetch', '-q', 'origin', base]);
  if (!await gitSucceeds(wt, ['merge-base', '--is-ancestor', `origin/${base}`, 'HEAD'])) {
    throw new HandBackConflict(`origin/${base} has moved past this branch; have the agent rebase onto origin/${base}, then verify again`);
  }
  const commits = Number(await git(wt, ['rev-list', '--count', `origin/${base}..HEAD`]));
  if (commits === 0) throw new HandBackConflict(`nothing to ship: origin/${base} already has this work`);
  await git(wt, ['push', '-q', 'origin', `HEAD:refs/heads/${base}`]);

  const shipped = { head, base, commits, at: new Date().toISOString() };
  update(root, project, session.id, (s) => ({ ...s, shipped }));
  return shipped;
}

/**
 * Ends the session and throws its work away: `ws agent stop`, then the worktree and its
 * branch are removed through the product repository's own git.
 */
export async function discardSession(root: string, project: string, deps: HandBackDeps): Promise<void> {
  const session = sessionOf(root, project);
  const base = join(root, '.local', 'worktrees', project);
  const real = (path: string) => (existsSync(path) ? realpathSync(path) : path);
  const worktree = real(session.worktree);
  if (!worktree.startsWith(real(base) + sep)) {
    throw new Error(`a session worktree lives under .local/worktrees/${project}/; refusing to remove ${session.worktree}`);
  }

  await deps.ws(['agent', 'stop', 'agent-control session discarded'], { WS_SESSION_ID: session.id, WS_AGENT: 'agent-control' });
  if (existsSync(worktree)) {
    const common = await git(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    await git(root, ['--git-dir', common, 'worktree', 'remove', '--force', worktree]);
    await git(root, ['--git-dir', common, 'branch', '-D', session.branch]).catch(() => '');
  }
  writeCodingSession(root, project, null);
}
