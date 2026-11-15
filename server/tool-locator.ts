import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync, chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

export const TOOL_NAMES = ['ws', 'brain', 'rg', 'git'] as const;
export type ToolName = typeof TOOL_NAMES[number];
export type ToolSource = 'override' | 'bundled' | 'user-bin' | 'homebrew' | 'login-shell' | 'path' | 'missing';

export interface ToolStatus {
  name: ToolName;
  available: boolean;
  path: string | null;
  source: ToolSource;
  overridden: boolean;
}

export interface ToolLocatorOptions {
  homeDir?: string;
  bundledDirs?: string[];
  homebrewDirs?: string[];
  loginShellPathDirs?: string[];
  inheritedPathDirs?: string[];
  overridesPath?: string;
}

export const isToolName = (value: string): value is ToolName => (TOOL_NAMES as readonly string[]).includes(value);

const OVERRIDES_MAX_BYTES = 16 * 1024;
const LOGIN_SHELL_TIMEOUT_MS = 2000;
const LOGIN_SHELL_MAX_BYTES = 64 * 1024;
const LOGIN_SHELL_MARKER = '__AGENT_CONTROL_LOGIN_PATH__';

export class ToolDependencyError extends Error {
  readonly code = 'TOOL_NOT_FOUND';
  readonly tool: ToolName;

  constructor(tool: ToolName) {
    super(`Required tool "${tool}" is unavailable. Configure its path in Settings.`);
    this.name = 'ToolDependencyError';
    this.tool = tool;
  }
}

export class ToolLocator {
  private readonly homeDir: string;
  private readonly bundledDirs: string[];
  private readonly homebrewDirs: string[];
  private readonly inheritedPathDirs: string[];
  private readonly overridesPath: string;
  private loginShellPathDirs: string[];
  private overrides: Partial<Record<ToolName, string>>;

  constructor(options: ToolLocatorOptions = {}) {
    this.homeDir = options.homeDir ?? homedir();
    this.bundledDirs = options.bundledDirs ?? splitPath(process.env.AC_BUNDLED_TOOLS_DIR ?? '');
    this.homebrewDirs = options.homebrewDirs ?? homebrewDirectories();
    this.loginShellPathDirs = cleanDirectories(options.loginShellPathDirs ?? []);
    this.inheritedPathDirs = cleanDirectories(options.inheritedPathDirs ?? splitPath(process.env.PATH ?? ''));
    this.overridesPath = options.overridesPath ?? join(this.homeDir, '.agent-control', 'tool-paths.json');
    this.overrides = this.readOverrides();
  }

  resolve(name: ToolName, workspaceRoot?: string): string {
    const status = this.locate(name, workspaceRoot);
    if (!status.path) throw new ToolDependencyError(name);
    return status.path;
  }

  status(workspaceRoot?: string): ToolStatus[] {
    return TOOL_NAMES.map((name) => this.locate(name, workspaceRoot));
  }

  async setOverride(name: ToolName, requestedPath: string): Promise<ToolStatus[]> {
    const resolved = validateExecutablePath(requestedPath);
    const previous = this.overrides;
    this.overrides = { ...this.overrides, [name]: resolved };
    try {
      this.persistOverrides();
    } catch (error) {
      this.overrides = previous;
      throw error;
    }
    return this.status();
  }

  async clearOverride(name: ToolName): Promise<ToolStatus[]> {
    const previous = this.overrides;
    const next = { ...this.overrides };
    delete next[name];
    this.overrides = next;
    try {
      this.persistOverrides();
    } catch (error) {
      this.overrides = previous;
      throw error;
    }
    return this.status();
  }

  loginShellPaths(): string[] {
    return [...this.loginShellPathDirs];
  }

  refreshLoginShellPath(): ToolStatus[] {
    if (process.platform === 'win32') {
      this.loginShellPathDirs = [];
      return this.status();
    }
    let shell = process.env.SHELL;
    if (!shell) {
      try { shell = userInfo().shell || undefined; } catch { shell = undefined; }
    }
    if (!shell || !isAbsolute(shell) || !isExecutable(shell)) {
      this.loginShellPathDirs = [];
      return this.status();
    }
    const result = spawnSync(shell, ['-lc', `printf '\\n${LOGIN_SHELL_MARKER}%s\\n' "$PATH"`], {
      encoding: 'utf8',
      timeout: LOGIN_SHELL_TIMEOUT_MS,
      maxBuffer: LOGIN_SHELL_MAX_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: createLoginShellEnvironment(shell),
    });
    const output = typeof result.stdout === 'string' ? result.stdout : '';
    if (result.error || result.status !== 0) {
      this.loginShellPathDirs = [];
    } else {
      this.loginShellPathDirs = parseLoginShellPath(output);
    }
    return this.status();
  }

  private locate(name: ToolName, workspaceRoot?: string): ToolStatus {
    const overridden = this.overrides[name] ?? environmentOverride(name);
    if (overridden) {
      let path: string | null = null;
      try { path = validateExecutablePath(overridden); } catch { /* stale override stays visibly unresolved */ }
      return { name, available: Boolean(path), path, source: path ? 'override' : 'missing', overridden: true };
    }

    const workspaceBins = name === 'ws' && workspaceRoot
      ? [join(workspaceRoot, '.agents', 'bin')]
      : [];
    const homeBin = [join(this.homeDir, '.agent-control', 'bin')];
    const groups: Array<[ToolSource, string[]]> = [
      ['bundled', [...workspaceBins, ...this.bundledDirs]],
      ['user-bin', homeBin],
      ['homebrew', this.homebrewDirs],
      ['login-shell', this.loginShellPathDirs],
      ['path', this.inheritedPathDirs],
    ];
    for (const [source, directories] of groups) {
      const path = findExecutable(directories, name);
      if (path) return { name, available: true, path, source, overridden: false };
    }
    return { name, available: false, path: null, source: 'missing', overridden: false };
  }

  private readOverrides(): Partial<Record<ToolName, string>> {
    try {
      const metadata = lstatSync(this.overridesPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > OVERRIDES_MAX_BYTES) return {};
      const value = JSON.parse(readFileSync(this.overridesPath, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const record = value as Record<string, unknown>;
      if (record.schemaVersion !== 1 || !record.overrides || typeof record.overrides !== 'object' || Array.isArray(record.overrides)) return {};
      const raw = record.overrides as Record<string, unknown>;
      const result: Partial<Record<ToolName, string>> = {};
      for (const name of TOOL_NAMES) {
        const path = raw[name];
        if (typeof path === 'string' && isAbsolute(path)) result[name] = path;
      }
      return result;
    } catch {
      return {};
    }
  }

  private persistOverrides(): void {
    const directory = dirname(this.overridesPath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dirInfo = lstatSync(directory);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error('Tool override directory is unsafe.');
    chmodSync(directory, 0o700);
    const temporary = `${this.overridesPath}.${process.pid}.${randomUUID()}.tmp`;
    const contents = JSON.stringify({ schemaVersion: 1, overrides: this.overrides }, null, 2) + '\n';
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    try {
      renameSync(temporary, this.overridesPath);
      chmodSync(this.overridesPath, 0o600);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* cleanup best effort */ }
      throw error;
    }
  }
}

export function createLoginShellEnvironment(shell: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'PATH'] as const;
  const environment: NodeJS.ProcessEnv = { SHELL: shell };
  for (const key of allowed) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export const toolLocator = new ToolLocator();

function environmentOverride(name: ToolName): string | undefined {
  const key = name === 'brain' ? 'AGENT_BRAIN_BINARY' : `AGENT_CONTROL_${name.toUpperCase()}_BINARY`;
  const value = process.env[key]?.trim();
  return value || undefined;
}

export function splitPath(value: string): string[] {
  return cleanDirectories(value.split(delimiter));
}

export function parseLoginShellPath(output: string): string[] {
  const markerIndex = output.lastIndexOf(LOGIN_SHELL_MARKER);
  if (markerIndex < 0) return [];
  const pathValue = output.slice(markerIndex + LOGIN_SHELL_MARKER.length).split(/\r?\n/, 1)[0] ?? '';
  return splitPath(pathValue);
}

function cleanDirectories(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path.length > 0 && isAbsolute(path)).map((path) => resolve(path)))];
}

function homebrewDirectories(): string[] {
  if (process.platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin'];
  if (process.platform === 'linux') return ['/home/linuxbrew/.linuxbrew/bin', join(homedir(), '.linuxbrew', 'bin')];
  return [];
}

function toolFileName(name: ToolName): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function findExecutable(directories: string[], name: ToolName): string | null {
  for (const directory of directories) {
    const candidate = join(directory, toolFileName(name));
    try {
      const realPath = realpathSync(candidate);
      if (isExecutable(realPath)) return realPath;
    } catch { /* not present in this search directory */ }
  }
  return null;
}

function validateExecutablePath(path: string): string {
  if (!isAbsolute(path) || path.length > 4096 || path.includes('\0')) throw new Error('Tool override must be an absolute file path.');
  const realPath = realpathSync(path);
  if (!isExecutable(realPath)) throw new Error('Tool override must point to an executable file.');
  return realPath;
}

function isExecutable(path: string): boolean {
  try {
    const info = statSync(path);
    if (!info.isFile()) return false;
    if (process.platform === 'win32') return path.toLowerCase().endsWith('.exe');
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
