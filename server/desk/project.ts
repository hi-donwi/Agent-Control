import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCodingSession } from '../coding-sessions.js';
import { loadPolicy } from '../policy.js';
import { readCollection } from './collections.js';
import type { Floor, FloorAgent } from './floor.js';
import { readRegistry } from './registry.js';
import { KEY_RE, contextDir, inside } from './workspace-files.js';

/**
 * Everything the desk's project room shows about one project, read in one call: memory
 * (stage, focus, next up, blockers, decisions, log, notes), work (operator tasks and the
 * plan rows of open runs), who is in the room, what is waiting for a person, and what an
 * agent bound here may load and reach. Read-only; every change goes through `ws`.
 */
export interface BlockedOn {
  item: string;
  waitingFor: string;
  since: string;
}

export interface ActiveMemory {
  updated: string;
  stage: string;
  focus: string;
  nextUp: string[];
  blockedOn: BlockedOn[];
}

const CELL_SPLIT = /(?<!\\)\|/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(CELL_SPLIT).map((cell) => cell.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '');
}

/** The lines of a `## <heading>` section, up to the next `## `. */
function section(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (at < 0) return [];
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The rows of the first table in `lines`, header and separator skipped. */
function tableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  let header = false;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (rows.length || header) break;
      continue;
    }
    const cells = tableCells(line);
    if (!header) { header = true; continue; }
    if (isSeparator(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

function field(text: string, name: string): string {
  // [ \t]*, not \s*: an empty field must not swallow the next line.
  const match = text.match(new RegExp(`^- \\*\\*${name}:\\*\\*[ \\t]*(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

const EMPTY = /^(none|-|n\/a)?$/i;

export function parseActive(text: string): ActiveMemory {
  return {
    updated: field(text, 'Updated'),
    stage: field(text, 'Stage'),
    focus: field(text, 'Current focus'),
    nextUp: section(text, 'Next up')
      .filter((line) => /^\s*- /.test(line))
      .map((line) => line.replace(/^\s*- /, '').trim())
      .filter((item) => !EMPTY.test(item)),
    blockedOn: tableRows(section(text, 'Blocked on'))
      .map(([item = '', waitingFor = '', since = '']) => ({ item, waitingFor, since }))
      .filter((row) => !EMPTY.test(row.item)),
  };
}

/** Decisions: rows of a `| Date | Decision | ... |` table, or `## ` headings; newest last. */
export function parseDecisions(text: string): Array<{ date: string; title: string }> {
  const rows = tableRows(text.split('\n'))
    .filter(([date = '', title = '']) => title && !EMPTY.test(title) && !/^date$/i.test(date))
    .map(([date = '', title = '']) => ({ date, title }));
  if (rows.length) return rows;
  return text.split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => {
      const heading = line.slice(3).trim();
      const match = heading.match(/^(\d{4}-\d{2}-\d{2})[^—-]*[—-]\s*(.+)$/);
      return match ? { date: match[1], title: match[2] } : { date: '', title: heading };
    });
}

/** Log milestones: rows of the `| Date | Milestone |` table, in file order. */
export function parseLog(text: string): Array<{ date: string; text: string }> {
  return tableRows(text.split('\n'))
    .filter(([date = '', entry = '']) => entry && /^\d{4}-\d{2}-\d{2}/.test(date))
    .map(([date = '', entry = '']) => ({ date, text: entry }));
}

function readMemory(root: string, project: string, file: string): string {
  const path = inside(contextDir(root), 'memory', 'projects', project, file);
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

/** The files `ws context pack` lists for a project of this client, those that exist. */
function packFiles(root: string, project: string, client: string): string[] {
  const ctx = contextDir(root);
  const candidates = [
    ...(KEY_RE.test(client) ? [join('clients', client, 'client.md'), join('clients', client, 'decisions.md')] : []),
    ...['project.md', 'active.md', 'decisions.md'].map((file) => join('memory', 'projects', project, file)),
  ];
  return candidates.filter((path) => existsSync(join(ctx, path))).map((path) => join('context', path));
}

const RECENT = 6;

export function projectDetail(root: string, project: string, floor: Floor) {
  if (!KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  const row = readRegistry(root).find((r) => r.key === project);
  const zone = floor.zones.find((z) => z.rooms.some((r) => r.key === project));
  const room = zone?.rooms.find((r) => r.key === project);
  if (!row && !room) throw new Error(`unknown project '${project}'`);
  const client = row?.client ?? zone?.client ?? '-';

  const active = parseActive(readMemory(root, project, 'active.md'));
  const decisions = parseDecisions(readMemory(root, project, 'decisions.md')).slice(-RECENT).reverse();
  const log = parseLog(readMemory(root, project, 'log.md'))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, RECENT);
  const read = (name: Parameters<typeof readCollection>[1]) => readCollection(root, name, project, floor);
  const notes = read('notes').slice(0, RECENT);
  const tasks = read('backlog');
  const plans = read('tasks');
  const runs = read('runs').filter((run) => !['done', 'dropped'].includes(String(run.state)));
  const approvals = read('approvals');
  const agents: FloorAgent[] = room?.agents ?? [];
  const policy = loadPolicy(root, project);
  const allowed = policy && Array.isArray(policy.llm?.endpoints)
    ? (policy.llm!.endpoints as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];

  return {
    key: project,
    client,
    group: row?.group ?? room?.group ?? '-',
    description: row?.description ?? room?.description ?? '',
    folder: row?.folder ?? '',
    memory: {
      ...active,
      decisions,
      log,
      notes: notes.map((n) => ({ name: String(n.name), updated: String(n.updated), excerpt: String(n.excerpt) })),
    },
    tasks,
    plans,
    runs,
    approvals,
    agents,
    codingSession: readCodingSession(root, project),
    context: {
      pack: packFiles(root, project, client),
      policy: policy ? { default: policy.default, actions: Object.keys(policy.actions ?? {}).length, endpoints: allowed } : null,
    },
  };
}
