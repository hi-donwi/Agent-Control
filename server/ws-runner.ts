import { execFile } from 'node:child_process';
import type { SessionRunner } from './coding-sessions.js';
import type { HandBackDeps } from './hand-back.js';
import { ToolDependencyError, toolLocator } from './tool-locator.js';
import { allowlistedChildEnv } from './child-env.js';

/** The real `ws` CLI and `git`, for coding-sessions.ts outside its tests. */
export function realSessionRunner(workspaceRoot: string): SessionRunner {
  return {
    runWs: (args, env) => new Promise((resolve, reject) => {
      let wsBin: string;
      try { wsBin = toolLocator.resolve('ws', workspaceRoot); } catch (error) { reject(error); return; }
      execFile(wsBin, args, {
        cwd: workspaceRoot,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: allowlistedChildEnv(process.env, env),
      }, (err, stdout, stderr) => {
        if (err?.code === 'ENOENT') reject(new ToolDependencyError('ws'));
        else if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    }),
    currentBranch: (worktree) => new Promise((resolve, reject) => {
      let gitBin: string;
      try { gitBin = toolLocator.resolve('git'); } catch (error) { reject(error); return; }
      execFile(gitBin, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree, timeout: 5000 }, (err, stdout) => {
        if (err?.code === 'ENOENT') reject(new ToolDependencyError('git'));
        else if (err) reject(err);
        else resolve(stdout.trim());
      });
    }),
  };
}

/**
 * `ws` for server/hand-back.ts: resolves on any exit code, since `ws verify` reports
 * findings with exit 1. A verification contract may run long, so the limit is generous.
 */
export function realHandBackDeps(workspaceRoot: string): HandBackDeps {
  return {
    ws: (args, env) => new Promise((resolve) => {
      let wsBin: string;
      try { wsBin = toolLocator.resolve('ws', workspaceRoot); } catch (error) {
        resolve({ code: 127, stdout: '', stderr: error instanceof Error ? error.message : new ToolDependencyError('ws').message });
        return;
      }
      execFile(wsBin, args, {
        cwd: workspaceRoot,
        timeout: 30 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: allowlistedChildEnv(process.env, env),
      }, (err, stdout, stderr) => {
        if (err?.code === 'ENOENT') {
          resolve({ code: 127, stdout: '', stderr: new ToolDependencyError('ws').message });
          return;
        }
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout, stderr: stderr || (err && typeof err.code !== 'number' ? err.message : '') });
      });
    }),
  };
}
