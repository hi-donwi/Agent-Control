import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';

/** The same cap `WorkspaceBridge.readProjectFile()` applies to the primary checkout. */
const MAX_FILE = 512 * 1024;

/** The absolute path of `relPath` inside `worktree`, refusing anything that climbs out. */
function resolveInside(worktree: string, relPath: string): string {
  const abs = resolve(worktree, relPath);
  const rel = relative(worktree, abs);
  if (isAbsolute(relPath) || rel === '..' || rel.startsWith('..' + '/') || isAbsolute(rel)) {
    throw new Error(`${relPath} is outside the worktree`);
  }
  return abs;
}

export async function writeWorktreeFile(worktree: string, relPath: string, content: string): Promise<void> {
  const abs = resolveInside(worktree, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf-8');
}

export async function readWorktreeFile(worktree: string, relPath: string): Promise<string> {
  const abs = resolveInside(worktree, relPath);
  const info = await stat(abs);
  if (!info.isFile()) throw new Error(`${normalize(relPath)} is not a file`);
  if (info.size > MAX_FILE) throw new Error(`${normalize(relPath)} is too large (max ${MAX_FILE / 1024}KB)`);
  return readFile(abs, 'utf-8');
}

export type EditResult = { replaced: true } | { error: string };

/**
 * Replaces `oldString` with `newString` in a worktree file - only when it appears
 * exactly once, the same discipline an editor's own exact-match replacement uses: an
 * ambiguous match is refused rather than guessed at.
 */
export async function editWorktreeFile(worktree: string, relPath: string, oldString: string, newString: string): Promise<EditResult> {
  const abs = resolveInside(worktree, relPath);
  const content = await readFile(abs, 'utf-8');
  const count = content.split(oldString).length - 1;
  if (count === 0) return { error: `oldString was not found in ${normalize(relPath)}` };
  if (count > 1) return { error: `oldString matches ${count} places in ${normalize(relPath)} - include more context to make it unique` };
  await writeFile(abs, content.replace(oldString, newString), 'utf-8');
  return { replaced: true };
}

function runGit(worktree: string, args: string[]): Promise<string> {
  return new Promise((resolve_, reject) => {
    execFile('git', args, { cwd: worktree, timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve_(stdout);
    });
  });
}

/**
 * `git diff` in the worktree, optionally scoped to one path. Empty text for a clean
 * tree. `async` so a path outside the worktree rejects the returned promise rather than
 * throwing synchronously before one exists - the same contract every caller expects.
 *
 * A plain `git diff` never shows a file write_file just created - it is untracked, not
 * modified. `git add -N` (intent-to-add) marks new paths for the diff without staging
 * their content, so a newly written file appears as entirely added, the same as one
 * that was edited.
 */
export async function gitDiff(worktree: string, relPath?: string): Promise<string> {
  if (relPath) resolveInside(worktree, relPath); // throws on a path outside the worktree
  await runGit(worktree, ['add', '-A', '-N', '--', relPath ?? '.']).catch(() => '');
  const args = relPath ? ['diff', '--', relPath] : ['diff'];
  return runGit(worktree, args);
}

export { MAX_FILE };
