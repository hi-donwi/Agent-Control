import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** `key = value` lines of `<root>/workspace.conf`; comments and blank lines skipped. */
export function readWorkspaceConf(root: string): Record<string, string> {
  const path = join(root, 'workspace.conf');
  if (!existsSync(path)) return {};
  const conf: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf-8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    conf[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return conf;
}

/** The context repository, where `ws` keeps the registry, memory, runs, and clocks. */
export function contextDir(root: string): string {
  const configured = readWorkspaceConf(root).context_dir || 'context';
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

/** `max_agent_session_hours`: an agent clock open longer than this is abandoned, not running. */
export function maxAgentSessionHours(root: string): number {
  const hours = Number(readWorkspaceConf(root).max_agent_session_hours);
  return Number.isFinite(hours) && hours > 0 ? hours : 8;
}

/** Joins `parts` under `base` and refuses any result that escapes it. */
export function inside(base: string, ...parts: string[]): string {
  const target = resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes ${base}`);
  }
  return target;
}

/** The first `bytes` of a file as text: enough for a title or an excerpt of a large log. */
export function readHead(path: string, bytes = 4096): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString('utf-8');
  } finally {
    closeSync(fd);
  }
}
