import { execFile } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/**
 * Bridge to the `ws` CLI for workspace awareness.
 * All calls use execFile (not exec) to prevent command injection.
 */
export class WorkspaceBridge {
  workspaceRoot: string;
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /** Run a ws subcommand and return stdout. */
  ws(args: string[]): Promise<string> {
    const wsBin = resolve(this.workspaceRoot, '.agents', 'bin', 'ws');
    return new Promise((ok, fail) => {
      execFile(wsBin, args, {
        cwd: this.workspaceRoot,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PAGER: 'cat' },
      }, (err, stdout, stderr) => {
        if (err) fail(new Error(`ws ${args.join(' ')} failed: ${stderr || err.message}`));
        else ok(stdout);
      });
    });
  }

  /** List all registered projects. */
  async listProjects(): Promise<string> {
    return this.ws(['list']);
  }

  /** Get the project tree (client > group > project). */
  async tree(): Promise<string> {
    return this.ws(['tree']);
  }

  /** Get health status. */
  async health(): Promise<string> {
    try {
      return await this.ws(['doctor', '--ci']);
    } catch {
      return 'Health check failed or not available.';
    }
  }

  /** Get context pack for a project. */
  async contextPack(projectKey: string): Promise<string> {
    // Validate project key: alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(projectKey)) {
      throw new Error('Invalid project key');
    }
    return this.ws(['context', 'pack', projectKey]);
  }

  /** Read a file within the workspace, sandboxed. */
  async readProjectFile(filePath: string): Promise<string> {
    const resolved = resolve(this.workspaceRoot, filePath);
    // Security: ensure resolved path is within workspace root
    if (!resolved.startsWith(this.workspaceRoot + sep)) {
      throw new Error('File path escapes workspace boundary');
    }
    // Don't allow reading sensitive files
    const forbidden = ['.local', '.git', 'node_modules'];
    const relative = resolved.slice(this.workspaceRoot.length + 1);
    if (forbidden.some(f => relative.startsWith(f + sep) || relative === f)) {
      throw new Error('Access denied to this path');
    }
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error('Not a file');
    if (info.size > 512 * 1024) throw new Error('File too large (max 512KB)');
    return readFile(resolved, 'utf-8');
  }

  /** Search for a pattern in project files using ripgrep. */
  async search(query: string, projectFolder?: string): Promise<string> {
    // Validate and sanitize query
    if (!query || query.length > 200) {
      throw new Error('Invalid search query');
    }
    const searchPath = projectFolder
      ? resolve(this.workspaceRoot, projectFolder)
      : this.workspaceRoot;
    // Security: ensure search path is within workspace
    if (!searchPath.startsWith(this.workspaceRoot)) {
      throw new Error('Search path escapes workspace boundary');
    }
    return new Promise((ok) => {
      execFile('rg', [
        '--json', '-i', '--max-count', '20', '--max-filesize', '256K',
        '-g', '!node_modules', '-g', '!.git', '-g', '!dist',
        '-g', '!.local', '-g', '!*.lock',
        query, searchPath,
      ], { timeout: 10_000, maxBuffer: 512 * 1024 }, (err, stdout) => {
        if (err && !stdout) ok('No results found.');
        else ok(stdout);
      });
    });
  }

  /** Get route recommendations for a task. */
  async route(taskDescription: string, projectKey?: string): Promise<string> {
    if (taskDescription.length > 500) {
      throw new Error('Task description too long');
    }
    const args = ['route'];
    if (projectKey && /^[a-zA-Z0-9_-]+$/.test(projectKey)) {
      args.push('--project', projectKey);
    }
    args.push(taskDescription);
    return this.ws(args);
  }
}
