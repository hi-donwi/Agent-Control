import { execFile } from 'node:child_process';

/** The repository's current commit, or null when `cwd` is not inside a git repository. */
export function headSha(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}
