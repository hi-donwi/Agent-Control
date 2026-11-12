import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** True when `candidate` is `root` itself or lies beneath it. Both must already be resolved. */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const DENIED_DIRECTORIES = new Set(['.git', '.local']);
const ENV_FILE = /^\.env(rc)?(\..+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template)$/;

/**
 * The first segment of `relativePath` that a model-facing file tool never crosses:
 * repository metadata, private local material, and env files (their templates excepted).
 * Compared in lower case, because a case-insensitive file system resolves `.GIT` to `.git`.
 */
export function deniedSegment(relativePath: string): string | undefined {
  return relativePath.split(/[\\/]+/).find((segment) => {
    const name = segment.toLowerCase();
    return DENIED_DIRECTORIES.has(name) || (ENV_FILE.test(name) && !ENV_TEMPLATE.test(name));
  });
}

function crossesDenied(relativePath: string, exemptPrefix?: string): boolean {
  const checked = exemptPrefix && relativePath.startsWith(exemptPrefix + sep)
    ? relativePath.slice(exemptPrefix.length + 1)
    : relativePath;
  return deniedSegment(checked) !== undefined;
}

/** A real location inside the root (`relative` is its path from the real root), or why it was refused. */
export type Located = { path: string; relative: string } | { refused: 'outside' | 'denied' };

/**
 * Where `target` (resolved against `root`) really is once symlinks are followed.
 *
 * A path that only looks contained is not enough: a symlink inside the root can point
 * anywhere. Both the path as given and the real location behind it must stay inside
 * `root` and clear of the denied segments. `exemptPrefix` names one root-relative
 * directory whose own segments are not checked - what lies beneath it still is.
 *
 * Rejects with the file system's own error when `target` does not exist.
 */
export async function locateInside(root: string, target: string, exemptPrefix?: string): Promise<Located> {
  const base = resolve(root);
  const requested = resolve(base, target);
  if (!isInside(base, requested)) return { refused: 'outside' };
  if (crossesDenied(relative(base, requested), exemptPrefix)) return { refused: 'denied' };
  const realBase = await realpath(base);
  const real = await realpath(requested);
  if (!isInside(realBase, real)) return { refused: 'outside' };
  const realRelative = relative(realBase, real);
  if (crossesDenied(realRelative, exemptPrefix)) return { refused: 'denied' };
  return { path: real, relative: realRelative };
}
