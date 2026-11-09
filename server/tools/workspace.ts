import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { parseProjectList } from '../projects.js';

/** Resolve the workspace root containing AGENTS.md and .agents/standards. */
export function findWorkspaceRoot(startDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.AC_DESKTOP_MODE === '1') {
    const selectedRoot = env.WS_WORKSPACE_ROOT;
    if (!selectedRoot) {
      throw new Error('Desktop mode requires an explicitly selected workspace root.');
    }
    const root = resolve(selectedRoot);
    let validMarkers = false;
    try {
      validMarkers = isAbsolute(selectedRoot)
        && statSync(join(root, 'AGENTS.md')).isFile()
        && statSync(join(root, '.agents', 'standards')).isDirectory();
    } catch {
      validMarkers = false;
    }
    if (!validMarkers) {
      throw new Error('Desktop workspace root does not contain the required workspace markers.');
    }
    return root;
  }
  if (env.WS_WORKSPACE_ROOT && existsSync(env.WS_WORKSPACE_ROOT)) {
    return resolve(env.WS_WORKSPACE_ROOT);
  }
  let dir = resolve(startDir ?? import.meta.dirname ?? process.cwd());
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, 'AGENTS.md')) &&
      existsSync(join(dir, '.agents', 'standards'))
    ) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

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
    if (projectKey !== undefined) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectKey)) throw new Error('Invalid project scope for skill routing.');
      args.push('--project', projectKey);
    }
    args.push(taskDescription);
    return this.ws(args);
  }

  /** Read a public skill, or a skill routed inside the explicitly bound local project. */
  async readSkill(skillName: string, projectKey?: string): Promise<string> {
    const cleanName = skillName.trim();
    if (!cleanName || !/^[a-zA-Z0-9_-]+$/.test(cleanName)) {
      throw new Error('Invalid skill name.');
    }

    const publicSkill = await this.readSafeSkillFile(join('.agents', 'skills', cleanName, 'SKILL.md'), join('.agents', 'skills'));
    if (publicSkill) return publicSkill;
    if (!projectKey) throw new Error('Skill not found in the public workspace catalog.');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectKey)) throw new Error('Invalid project scope for skill lookup.');

    let routedPath: string | undefined;
    try {
      const task = `load skill ${cleanName.replace(/[-_]+/g, ' ')}`;
      routedPath = this.routedSkillPath(await this.route(task, projectKey), cleanName);
    } catch {
      throw new Error('No matching skill is available in the bound project context.');
    }
    if (!routedPath) throw new Error('No matching skill is available in the bound project context.');

    const entries = parseProjectList(await this.listProjects().catch(() => ''));
    const project = entries.find((entry) => entry.key === projectKey);
    if (!project) throw new Error('Skill project is not registered.');
    const contextDirectory = await this.contextDirectory();
    const allowed = [
      { file: join('.agents', 'skills', cleanName, 'SKILL.md'), directory: join('.agents', 'skills') },
      { file: join(contextDirectory, 'skills', cleanName, 'SKILL.md'), directory: join(contextDirectory, 'skills') },
      ...(project.client && project.client !== '-'
        ? [{
            file: join(contextDirectory, 'clients', project.client, 'skills', cleanName, 'SKILL.md'),
            directory: join(contextDirectory, 'clients', project.client, 'skills'),
          }]
        : []),
    ];
    const normalized = normalize(routedPath);
    const routed = allowed.find((candidate) => candidate.file === normalized);
    if (isAbsolute(normalized) || normalized.startsWith('..') || !routed) {
      throw new Error('Routed skill is outside the bound project catalog.');
    }
    const content = await this.readSafeSkillFile(routed.file, routed.directory);
    if (!content) throw new Error('Routed skill file is unavailable.');
    return content;
  }

  private routedSkillPath(output: string, skillName: string): string | undefined {
    for (const line of output.split('\n')) {
      const match = line.match(/^\s*\d+\s+([a-zA-Z0-9_-]+)\s+(\S+)\s*$/);
      if (match?.[1] === skillName) return match[2];
    }
    return undefined;
  }

  private async contextDirectory(): Promise<string> {
    let configured = 'context';
    try {
      const conf = await readFile(join(this.workspaceRoot, 'workspace.conf'), 'utf8');
      const line = conf.split(/\r?\n/).find((value) => /^\s*context_dir\s*=/.test(value));
      if (line) configured = line.slice(line.indexOf('=') + 1).split('#', 1)[0]!.trim() || 'context';
    } catch {
      return 'context';
    }
    const root = resolve(this.workspaceRoot);
    const resolved = resolve(root, configured);
    const relativePath = relative(root, resolved);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error('Workspace context directory is outside the selected root.');
    }
    return relativePath;
  }

  private async readSafeSkillFile(relativePath: string, relativeDirectory: string): Promise<string | undefined> {
    const root = await realpath(resolve(this.workspaceRoot));
    const directory = resolve(root, relativeDirectory);
    const directoryRelative = relative(root, directory);
    if (!directoryRelative || directoryRelative === '..' || directoryRelative.startsWith(`..${sep}`) || isAbsolute(directoryRelative)) {
      throw new Error('Skill path is outside the selected workspace.');
    }
    const candidate = resolve(root, relativePath);
    const withinDirectory = relative(directory, candidate);
    if (isAbsolute(withinDirectory) || withinDirectory.startsWith('..') || !/^[-A-Za-z0-9_]+[\\/]SKILL\.md$/.test(withinDirectory)) {
      throw new Error('Skill path is outside its catalog directory.');
    }
    let info;
    try {
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || await realpath(directory) !== directory) {
        throw new Error('Skill catalog directory is not a real workspace directory.');
      }
      const skillDirectory = resolve(directory, withinDirectory.split(/[\\/]/)[0]!);
      const skillDirectoryInfo = await lstat(skillDirectory);
      if (!skillDirectoryInfo.isDirectory() || skillDirectoryInfo.isSymbolicLink() || await realpath(skillDirectory) !== skillDirectory) {
        throw new Error('Skill directory is not a real catalog directory.');
      }
      info = await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('Skill file could not be accessed.');
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) {
      throw new Error('Skill file must be a regular file under the size limit.');
    }
    let realCandidate: string;
    let rootReal: string;
    try {
      [realCandidate, rootReal] = await Promise.all([realpath(candidate), realpath(root)]);
    } catch {
      throw new Error('Skill file could not be resolved safely.');
    }
    const realRelative = relative(rootReal, realCandidate);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
      throw new Error('Skill file resolves outside the selected workspace.');
    }
    try {
      return await readFile(realCandidate, 'utf8');
    } catch {
      throw new Error('Skill file could not be read.');
    }
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
