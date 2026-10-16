import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_RE, contextDir } from './workspace-files.js';

/** One registered project: the columns the desk shows, read by header name. */
export interface RegistryRow {
  key: string;
  client: string;
  group: string;
  folder: string;
  description: string;
}

/**
 * Rows of `context/registry.tsv`. Columns are found by their header name, so a registry
 * with more or fewer columns (v1 has four, later versions add more) reads the same.
 */
export function parseRegistry(tsv: string): RegistryRow[] {
  const lines = tsv.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  if (lines.length === 0) return [];
  const header = lines[0].split('\t').map((name) => name.trim());
  const column = (name: string) => header.indexOf(name);
  const [key, client, group, folder, description] =
    ['key', 'client', 'group', 'folder', 'description'].map(column);
  if (key < 0) return [];

  return lines.slice(1).flatMap((line) => {
    const cells = line.split('\t');
    const cell = (index: number) => (index >= 0 ? (cells[index] ?? '').trim() : '');
    const projectKey = cell(key);
    if (!KEY_RE.test(projectKey)) return [];
    const text = cell(description);
    return [{
      key: projectKey,
      client: cell(client) || '-',
      group: cell(group) || '-',
      folder: cell(folder) || '-',
      description: text === '-' ? '' : text,
    }];
  });
}

export function readRegistry(root: string): RegistryRow[] {
  const path = join(contextDir(root), 'registry.tsv');
  return existsSync(path) ? parseRegistry(readFileSync(path, 'utf-8')) : [];
}
