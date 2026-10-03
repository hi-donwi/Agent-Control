import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { SessionRunner } from './coding-sessions.js';

/** The real `ws` CLI and `git`, for coding-sessions.ts outside its tests. */
export function realSessionRunner(workspaceRoot: string): SessionRunner {
  const wsBin = join(workspaceRoot, '.agents', 'bin', 'ws');
  return {
    runWs: (args, env) => new Promise((resolve, reject) => {
      execFile(wsBin, args, {
        cwd: workspaceRoot,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PAGER: 'cat', ...env },
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    }),
    currentBranch: (worktree) => new Promise((resolve, reject) => {
      execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree, timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    }),
  };
}
