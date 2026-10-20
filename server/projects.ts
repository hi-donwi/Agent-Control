/** A registered project, as `ws list` prints it. */
export interface ProjectEntry {
  key: string;
  client: string;
  group: string;
  folder: string;
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Rows of `ws list` (with or without KIND column), header and noise skipped. */
export function parseProjectList(output: string): ProjectEntry[] {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  return plain.split('\n').flatMap((line) => {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) return [];
    const key = cols[0];
    if (!key || !KEY_RE.test(key)) return [];
    if (cols[3]?.startsWith('projects/')) {
      return [{ key, client: cols[1], group: cols[2], folder: cols[3] }];
    }
    if (cols[4]?.startsWith('projects/')) {
      return [{ key, client: cols[2], group: cols[3], folder: cols[4] }];
    }
    return [];
  });
}
