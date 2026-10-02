/** A registered project, as `ws list` prints it. */
export interface ProjectEntry {
  key: string;
  client: string;
  group: string;
  folder: string;
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Rows of `ws list` (KEY CLIENT GROUP FOLDER STATUS REMOTE), header and noise skipped. */
export function parseProjectList(output: string): ProjectEntry[] {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  return plain.split('\n').flatMap((line) => {
    const [key, client, group, folder] = line.trim().split(/\s+/);
    if (!key || !KEY_RE.test(key) || !folder?.startsWith('projects/')) return [];
    return [{ key, client, group, folder }];
  });
}
