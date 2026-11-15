import { execFile } from 'node:child_process';
import { ToolDependencyError, toolLocator } from './tool-locator.js';

/** The repository's current commit, or null when `cwd` is not inside a git repository. */
export function headSha(cwd: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let git: string;
    try { git = toolLocator.resolve('git'); } catch (error) { reject(error); return; }
    execFile(git, ['rev-parse', 'HEAD'], { cwd, timeout: 5000 }, (err, stdout) => {
      if (err?.code === 'ENOENT') reject(new ToolDependencyError('git'));
      else resolve(err ? null : stdout.trim());
    });
  });
}
