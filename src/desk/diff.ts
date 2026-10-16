/** One line of a file's diff, as the Changes view draws it. */
export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx';
  text: string;
}

export interface FileDiff {
  path: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Parses `git diff` output into files with their counts and lines. Binary files have no lines. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = { path: match ? match[2] : line.slice(11), status: 'modified', added: 0, removed: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('rename to ')) { current.status = 'renamed'; current.path = line.slice(10); }
    else if (line.startsWith('@@')) current.lines.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) continue;
    else if (line.startsWith('+')) { current.added++; current.lines.push({ kind: 'add', text: line.slice(1) }); }
    else if (line.startsWith('-')) { current.removed++; current.lines.push({ kind: 'del', text: line.slice(1) }); }
    else if (line.startsWith(' ')) current.lines.push({ kind: 'ctx', text: line.slice(1) });
  }
  return files;
}
