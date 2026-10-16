import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listPending } from '../approvals.js';
import type { Floor } from './floor.js';
import { KEY_RE, contextDir, inside, readHead } from './workspace-files.js';

/**
 * Read-only record sets for the desk's drawer sections. Each one answers in the shape a
 * UIDL `DataAdapter.query` returns, so a section document can bind a table to it. Nothing
 * here writes: notes, tasks, and runs change through `ws` (ADR-0019 §2).
 */
export const COLLECTIONS = ['projects', 'agents', 'approvals', 'memory', 'runs', 'tasks', 'backlog', 'notes'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];
/** Collections that only make sense for one project, and refuse a request without one. */
export const PROJECT_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['memory', 'runs', 'tasks', 'backlog', 'notes']);

export type Row = Record<string, string | number>;

export function isCollection(name: string): name is CollectionName {
  return (COLLECTIONS as readonly string[]).includes(name);
}

const MAX_ROWS = 500;
const EXCERPT_CHARS = 160;
const CLOSED_RUN_STATES = new Set(['done', 'dropped']);

export function excerpt(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^([-*>]\s+)+/, '');
    if (!line || line.startsWith('#') || line.startsWith('|') || line.startsWith('```') || line.startsWith('<!--')) continue;
    return line.length > EXCERPT_CHARS ? `${line.slice(0, EXCERPT_CHARS - 3)}...` : line;
  }
  return '';
}

/** `2026-10-16-164316-...` -> `2026-10-16 16:43`; anything else -> ''. */
export function runStarted(id: string): string {
  const match = id.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})\d{2}/);
  return match ? `${match[1]} ${match[2]}:${match[3]}` : '';
}

export function briefTitle(text: string, fallback: string): string {
  const heading = text.split('\n').find((line) => line.startsWith('# '));
  return heading ? heading.slice(2).trim() : fallback;
}

/**
 * The line under `## State` in a run's handoff. The template lists every state joined by
 * a middle dot; a handoff still showing that has not chosen one, so the run is `open`.
 */
export function handoffState(text: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.trim() === '## State');
  if (at < 0) return 'open';
  const line = lines.slice(at + 1).find((l) => l.trim())?.trim() ?? '';
  if (!line || line.startsWith('#') || line.includes('·')) return 'open';
  const ticked = line.match(/`([^`]+)`/)?.[1] ?? line;
  return ticked.split(/\s+[-—]\s+/)[0].trim().toLowerCase().slice(0, 40) || 'open';
}

/** Rows of the task table in a run's plan.md: `| # | Task | Status | Notes |`. */
export function planRows(text: string): Array<{ n: string; task: string; status: string; notes: string }> {
  return text.split('\n').flatMap((line) => {
    if (!line.trim().startsWith('|')) return [];
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    const [n = '', task = '', status = '', notes = ''] = cells;
    if (!task || n === '#' || /^:?-+:?$/.test(n) || /^:?-+:?$/.test(task)) return [];
    if (!/^\d+[a-z]?$/i.test(n)) return [];
    return [{ n, task, status: status.replace(/`/g, '') || 'pending', notes: notes.replace(/`/g, '') }];
  });
}

/** The flat `key: value` lines of a task document's front matter (ws_tasks.py, schema 1). */
export function taskFields(text: string): Record<string, string> {
  const lines = text.split('\n');
  if (lines[0] !== '---') return {};
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line === '---') break;
    const match = line.match(/^([a-z_]+):\s?(.*)$/);
    if (match && match[2] !== '') fields[match[1]] = match[2].trim();
  }
  return fields;
}

const STATUS_ORDER = ['in_progress', 'review', 'ready', 'backlog', 'done'];

/** Operator tasks with the revision `ws task status --revision` expects back. */
function backlogRows(root: string, project: string): Row[] {
  const dir = projectDir(root, 'tasks', project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    .flatMap((name) => {
      const path = join(dir, name);
      if (!lstatSync(path).isFile()) return [];
      const fields = taskFields(readHead(path, 8192));
      if (fields.schema_version !== '1' || !fields.id || fields.project !== project) return [];
      const stat = statSync(path, { bigint: true });
      return [{
        id: fields.id,
        title: fields.title ?? fields.id,
        status: fields.status ?? 'backlog',
        priority: fields.priority ?? 'normal',
        owner: fields.owner ?? 'unassigned',
        updated: (fields.updated_at ?? '').slice(0, 16).replace('T', ' '),
        revision: `mtime:${stat.mtimeNs}:size:${stat.size}`,
      }];
    })
    .sort((a, b) => STATUS_ORDER.indexOf(String(a.status)) - STATUS_ORDER.indexOf(String(b.status))
      || String(b.updated).localeCompare(String(a.updated)));
}

function projectDir(root: string, ...parts: string[]): string {
  return inside(contextDir(root), ...parts);
}

function markdownFiles(dir: string, titled = false): Row[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) => {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (!stat.isFile()) return [];
      const head = readHead(path);
      return [{
        id: name,
        name: titled ? briefTitle(head, name.replace(/\.md$/, '')) : name.replace(/\.md$/, ''),
        updated: stat.mtime.toISOString().slice(0, 16).replace('T', ' '),
        size: stat.size,
        excerpt: excerpt(head),
      }];
    })
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

function runRows(root: string, project: string): Row[] {
  const dir = projectDir(root, 'runs', project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((id) => lstatSync(join(dir, id)).isDirectory())
    .sort()
    .reverse()
    .slice(0, MAX_ROWS)
    .map((id) => {
      const read = (file: string) => (existsSync(join(dir, id, file)) ? readHead(join(dir, id, file), 8192) : '');
      return { id, started: runStarted(id), title: briefTitle(read('brief.md'), id), state: handoffState(read('handoff.md')) };
    });
}

function taskRows(root: string, project: string): Row[] {
  const dir = projectDir(root, 'runs', project);
  return runRows(root, project)
    .filter((run) => !CLOSED_RUN_STATES.has(String(run.state)))
    .flatMap((run) => {
      const plan = join(dir, String(run.id), 'plan.md');
      if (!existsSync(plan)) return [];
      // The revision `ws plan status --revision` checks, as ws_plan.py computes it.
      const stat = statSync(plan, { bigint: true });
      const revision = `mtime:${stat.mtimeNs}:size:${stat.size}`;
      return planRows(readFileSync(plan, 'utf-8')).map((row) => ({
        id: `${run.id}#${row.n}`,
        run: String(run.title),
        runId: String(run.id),
        revision,
        ...row,
      }));
    });
}

function approvalRows(root: string, projects: string[]): Row[] {
  return projects.flatMap((project) => {
    try {
      return listPending(root, project).map((request) => ({
        id: request.id,
        project,
        action: request.action,
        requestedAt: request.requestedAt,
        expiresAt: request.expiresAt,
      }));
    } catch {
      return [];
    }
  });
}

export function readCollection(root: string, name: CollectionName, project: string | undefined, floor: Floor): Row[] {
  if (PROJECT_COLLECTIONS.has(name) && !project) throw new Error(`${name} needs a project`);
  if (project !== undefined && !KEY_RE.test(project)) throw new Error(`invalid project key '${project}'`);
  const rooms = floor.zones.flatMap((zone) => zone.rooms.map((room) => ({ ...room, client: zone.client })));

  switch (name) {
    case 'projects':
      return rooms.map((room) => ({
        id: room.key,
        key: room.key,
        client: room.client,
        group: room.group,
        description: room.description,
        agents: room.agents.length,
        approvals: room.pendingApprovals,
      }));
    case 'agents':
      return rooms
        .flatMap((room) => room.agents)
        .filter((agent) => !project || agent.project === project)
        .map(({ id, tool, project: key, state, detail, since }) => ({ id, tool, project: key, state, detail, since }));
    case 'approvals':
      return approvalRows(root, project ? [project] : rooms.map((room) => room.key));
    case 'memory':
      return markdownFiles(projectDir(root, 'memory', 'projects', project!));
    case 'notes':
      return markdownFiles(projectDir(root, 'memory', 'projects', project!, 'notes'), true);
    case 'runs':
      return runRows(root, project!);
    case 'tasks':
      return taskRows(root, project!);
    case 'backlog':
      return backlogRows(root, project!);
  }
}

export interface CollectionQuery {
  search?: string;
  sort?: { field: string; dir: 'asc' | 'desc' };
  equals?: Record<string, string>;
  page?: number;
  pageSize?: number;
}

/** Search, equality filters, sort, and one page, in the `QueryResult` shape. */
export function queryRows(rows: Row[], query: CollectionQuery) {
  const needle = query.search?.trim().toLowerCase();
  let result = rows.filter((row) =>
    Object.entries(query.equals ?? {}).every(([field, value]) => String(row[field] ?? '') === value)
    && (!needle || Object.values(row).some((value) => String(value).toLowerCase().includes(needle))));
  if (query.sort) {
    const { field, dir } = query.sort;
    const sign = dir === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const x = a[field] ?? '';
      const y = b[field] ?? '';
      return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
  }
  const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), MAX_ROWS);
  const page = Math.max(query.page ?? 1, 1);
  return { rows: result.slice((page - 1) * pageSize, page * pageSize), total: result.length, page, pageSize };
}
