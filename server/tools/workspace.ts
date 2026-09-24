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

  /**
   * Resolve an executable binary path across environment, workspace paths, and system PATH.
   */
  async resolveBinary(name: string, localCandidates: string[]): Promise<string> {
    const envVar = `WS_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BIN`;
    if (process.env[envVar]) {
      const p = process.env[envVar]!;
      try {
        await stat(p);
        return p;
      } catch {
        // ignore invalid env var path and fallback
      }
    }

    for (const rel of localCandidates) {
      const p = resolve(this.workspaceRoot, rel);
      try {
        await stat(p);
        return p;
      } catch {
        // continue
      }
    }

    return new Promise((ok, fail) => {
      execFile('which', [name], (err, stdout) => {
        if (!err && stdout.trim()) {
          ok(stdout.trim());
        } else {
          fail(new Error(`Binary '${name}' not found. Please install or build it, or set ${envVar}.`));
        }
      });
    });
  }

  /**
   * Run dbakit for PostgreSQL health and diagnostics.
   * Allowed commands: health, diagnose, sessions, locks, replication, databases, indexes, xid, config, rules, version.
   */
  async dbakit(command: string = 'health', extraArgs: string[] = []): Promise<string> {
    const allowed = ['health', 'diagnose', 'sessions', 'locks', 'replication', 'databases', 'indexes', 'xid', 'config', 'rules', 'version'];
    const cleanCmd = command.trim().toLowerCase();
    if (!allowed.includes(cleanCmd)) {
      throw new Error(`Invalid dbakit command '${command}'. Allowed: ${allowed.join(', ')}`);
    }

    const sanitizedArgs = extraArgs.filter(arg => /^[a-zA-Z0-9_=-]+$/.test(arg));
    const bin = await this.resolveBinary('dbakit', [
      'projects/donwi/public/DBA-Toolkit/dbakit',
      'projects/donwi/public/DBA-Toolkit/bin/dbakit',
      '.agents/bin/dbakit',
    ]);

    const args = [cleanCmd, '--json', ...sanitizedArgs];
    return new Promise((ok, fail) => {
      execFile(bin, args, {
        cwd: this.workspaceRoot,
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (stdout && stdout.trim().startsWith('{')) {
          ok(stdout);
        } else if (err) {
          fail(new Error(`dbakit failed: ${stderr || err.message}`));
        } else {
          ok(stdout || 'No output produced.');
        }
      });
    });
  }

  /**
   * Run opskit for Linux host, Docker, Swarm, and Kubernetes SRE diagnostics.
   * Allowed commands: diag, audit, net, metrics, explain, version.
   */
  async opskit(command: string = 'diag', target?: string, extraArgs: string[] = []): Promise<string> {
    const allowedCmds = ['diag', 'audit', 'net', 'metrics', 'explain', 'version'];
    const cleanCmd = command.trim().toLowerCase();
    if (!allowedCmds.includes(cleanCmd)) {
      throw new Error(`Invalid opskit command '${command}'. Allowed: ${allowedCmds.join(', ')}`);
    }

    const bin = await this.resolveBinary('opskit', [
      'projects/donwi/public/OPS-Toolkit/bin/opskit',
      'projects/donwi/public/OPS-Toolkit/opskit',
      '.agents/bin/opskit',
    ]);

    const args = [cleanCmd];
    if (target && /^[a-zA-Z0-9_-]+$/.test(target)) {
      args.push(target);
    }
    args.push('--json');

    const sanitizedArgs = extraArgs.filter(arg => /^[a-zA-Z0-9_=-]+$/.test(arg));
    args.push(...sanitizedArgs);

    return new Promise((ok, fail) => {
      execFile(bin, args, {
        cwd: this.workspaceRoot,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (stdout && stdout.trim().startsWith('{')) {
          ok(stdout);
        } else if (err) {
          fail(new Error(`opskit failed: ${stderr || err.message}`));
        } else {
          ok(stdout || 'No output produced.');
        }
      });
    });
  }

  /**
   * Run security audit using ws scan (which delegates to agent-secure).
   */
  async agentSecure(projectKey: string, options?: { doctor?: boolean; policy?: string }): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectKey)) {
      throw new Error('Invalid project key');
    }

    let secureBin = process.env.WS_SECURE_BIN;
    if (!secureBin) {
      try {
        secureBin = await this.resolveBinary('agent-secure', [
          'projects/donwi/public/Agent-Secure/Agent-Secure',
          'projects/donwi/public/Agent-Secure/bin/agent-secure',
          '.agents/bin/agent-secure',
        ]);
      } catch {
        // ws scan will handle fallback
      }
    }

    const wsBin = resolve(this.workspaceRoot, '.agents', 'bin', 'ws');
    const args = ['scan', projectKey];
    if (options?.doctor) {
      args.push('--doctor');
    }
    if (options?.policy && /^[a-zA-Z0-9_/.-]+$/.test(options.policy)) {
      args.push('--policy', options.policy);
    }

    return new Promise((ok, fail) => {
      execFile(wsBin, args, {
        cwd: this.workspaceRoot,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          ...(secureBin ? { WS_SECURE_BIN: secureBin } : {}),
          PAGER: 'cat',
        },
      }, (err, stdout, stderr) => {
        if (stdout && stdout.trim()) {
          ok(stdout);
        } else if (err) {
          fail(new Error(`Security scan failed: ${stderr || err.message}`));
        } else {
          ok('No scan output produced.');
        }
      });
    });
  }
}
