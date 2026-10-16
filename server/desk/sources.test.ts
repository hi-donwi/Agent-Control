import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIVE_WINDOW_MS, clockState, parseOpenClock, readOpenClocks } from './clocks.js';
import { parseRegistry, readRegistry } from './registry.js';
import { briefTitle, excerpt, handoffState, planRows, queryRows, readCollection, runStarted } from './collections.js';
import { ActivityRegistry, deskFloor } from './index.js';
import { contextDir, inside, maxAgentSessionHours } from './workspace-files.js';

describe('parseRegistry', () => {
  it('reads columns by header name, whatever the column count', () => {
    const v1 = 'key\tclient\tgroup\tfolder\nalpha\tacme\t-\tprojects/acme/alpha\n';
    assert.deepEqual(parseRegistry(v1), [{ key: 'alpha', client: 'acme', group: '-', folder: 'projects/acme/alpha', description: '' }]);
    const later = 'key\tclient\tgroup\tfolder\tremote\tdescription\nbeta\town\t-\tprojects/own/beta\t-\tA tool\n';
    assert.equal(parseRegistry(later)[0].description, 'A tool');
  });

  it('skips rows whose key is not a project key', () => {
    assert.deepEqual(parseRegistry('key\tclient\n../x\tacme\n\n# note\n'), []);
    assert.deepEqual(parseRegistry('client\tfolder\nacme\tprojects/x\n'), []);
  });
});

describe('open clocks', () => {
  const record = { id: 'c1', kind: 'agent', project: 'alpha', actor: 'dev', tool: 'opencode', start: '2026-10-16T09:00:00+07:00', start_ts: 1_792_116_000, note: 'n' };

  it('parses an agent clock and refuses anything else', () => {
    assert.equal(parseOpenClock(JSON.stringify(record), 5)?.tool, 'opencode');
    assert.equal(parseOpenClock(JSON.stringify({ ...record, kind: 'human' }), 5), null);
    assert.equal(parseOpenClock(JSON.stringify({ ...record, project: '../x' }), 5), null);
    assert.equal(parseOpenClock('{not json', 5), null);
  });

  it('is working with a fresh heartbeat, idle with an old one, offline past the cap', () => {
    const clock = parseOpenClock(JSON.stringify(record), 0)!;
    const start = clock.startMs;
    assert.equal(clockState({ ...clock, heartbeatMs: start + 1000 }, start + 2000, 8), 'working');
    assert.equal(clockState({ ...clock, heartbeatMs: start }, start + ACTIVE_WINDOW_MS + 1, 8), 'idle');
    assert.equal(clockState(clock, start + 8 * 3600 * 1000 + 1, 8), 'offline');
  });
});

describe('run and memory parsing', () => {
  it('reads a run\'s start, title, and handoff state', () => {
    assert.equal(runStarted('2026-10-16-164316-dev-claude-code-x'), '2026-10-16 16:43');
    assert.equal(runStarted('initial-scaffold'), '');
    assert.equal(briefTitle('# Add export\n\n- **Project:** x', 'fallback'), 'Add export');
    assert.equal(handoffState('## State\n\n`not started` · `in progress` · `done`\n'), 'open');
    assert.equal(handoffState('## State\n\n`done`\n'), 'done');
    assert.equal(handoffState('## State\n\nready for review - waiting on CI\n'), 'ready for review');
    assert.equal(handoffState('# Handoff\n'), 'open');
  });

  it('reads plan task rows and skips the header, separator, and template rows', () => {
    const plan = [
      '| # | Task | Status | Notes |',
      '|---|---|---|---|',
      '| 1 | Write the parser | `done` | |',
      '| 2 | Wire the route | `in_progress` | after 1 |',
      '| 3 | | `pending` | |',
      '| Phase | Theme | Deliverables |',
    ].join('\n');
    assert.deepEqual(planRows(plan), [
      { n: '1', task: 'Write the parser', status: 'done', notes: '' },
      { n: '2', task: 'Wire the route', status: 'in_progress', notes: 'after 1' },
    ]);
  });

  it('takes the first prose line as the excerpt', () => {
    assert.equal(excerpt('# Title\n\n> Routing hint\n\n- **Updated:** today\n'), 'Routing hint');
    assert.equal(excerpt('x'.repeat(200)).length, 160);
  });
});

describe('queryRows', () => {
  const rows = [{ id: 'a', state: 'open', n: 2 }, { id: 'b', state: 'done', n: 1 }, { id: 'c', state: 'open', n: 3 }];

  it('filters, searches, sorts, and pages', () => {
    assert.deepEqual(queryRows(rows, { equals: { state: 'open' } }).rows.map((r) => r.id), ['a', 'c']);
    assert.deepEqual(queryRows(rows, { search: 'DONE' }).rows.map((r) => r.id), ['b']);
    assert.deepEqual(queryRows(rows, { sort: { field: 'n', dir: 'desc' } }).rows.map((r) => r.id), ['c', 'a', 'b']);
    assert.deepEqual(queryRows(rows, { page: 2, pageSize: 2 }), { rows: [rows[2]], total: 3, page: 2, pageSize: 2 });
  });
});

describe('workspace files', () => {
  it('refuses a path that escapes its base', () => {
    assert.throws(() => inside('/tmp/base', '..', 'etc'), /escapes/);
    assert.equal(inside('/tmp/base', 'a', 'b'), '/tmp/base/a/b');
  });
});

describe('deskFloor and readCollection on a disposable workspace', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ac-desk-'));
    writeFileSync(join(root, 'workspace.conf'), 'context_dir = ctx\nmax_agent_session_hours = 4\n');
    const ctx = join(root, 'ctx');
    mkdirSync(join(ctx, 'works'), { recursive: true });
    mkdirSync(join(ctx, 'memory', 'projects', 'alpha', 'notes'), { recursive: true });
    mkdirSync(join(ctx, 'runs', 'alpha', '2026-10-16-090000-dev-x-add-export'), { recursive: true });
    mkdirSync(join(ctx, 'runs', 'alpha', '2026-10-01-090000-dev-x-old-work'), { recursive: true });
    writeFileSync(join(ctx, 'registry.tsv'), 'key\tclient\tgroup\tfolder\nalpha\tacme\t-\tprojects/acme/alpha\n');
    writeFileSync(join(ctx, 'memory', 'projects', 'alpha', 'active.md'), '# alpha - active\n\nShipping the export.\n');
    writeFileSync(join(ctx, 'memory', 'projects', 'alpha', 'notes', 'idea.md'), 'Try a CSV first.\n');
    const open = join(ctx, 'runs', 'alpha', '2026-10-16-090000-dev-x-add-export');
    writeFileSync(join(open, 'brief.md'), '# Add export\n');
    writeFileSync(join(open, 'handoff.md'), '## State\n\n`in progress`\n');
    writeFileSync(join(open, 'plan.md'), '| # | Task | Status | Notes |\n|---|---|---|---|\n| 1 | CSV writer | `in_progress` | |\n');
    const done = join(ctx, 'runs', 'alpha', '2026-10-01-090000-dev-x-old-work');
    writeFileSync(join(done, 'handoff.md'), '## State\n\n`done`\n');
    writeFileSync(join(done, 'plan.md'), '| # | Task | Status | Notes |\n|---|---|---|---|\n| 1 | Old task | `done` | |\n');
    const clockFile = join(ctx, 'works', '.open-agent-dev-codex-s1.json');
    writeFileSync(clockFile, JSON.stringify({ id: 'k1', kind: 'agent', project: 'alpha', actor: 'dev', tool: 'codex', start: '2026-10-16T09:00:00Z', start_ts: Date.parse('2026-10-16T09:00:00Z') / 1000, note: 'export' }));
    const beat = new Date('2026-10-16T09:59:00Z');
    utimesSync(clockFile, beat, beat);
    writeFileSync(join(ctx, 'works', '.open-human-dev.json'), '{}');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('honours workspace.conf for the context dir and the session cap', () => {
    assert.equal(contextDir(root), join(root, 'ctx'));
    assert.equal(maxAgentSessionHours(root), 4);
    assert.equal(readRegistry(root).length, 1);
    assert.equal(readOpenClocks(root).length, 1);
  });

  it('takes an outside agent\'s pose from its activity record', () => {
    const dir = join(root, '.local', 'agent', 'activity');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 's1.json'), JSON.stringify({
      version: 1, session: 's1', project: 'alpha', tool: 'codex', state: 'running', detail: 'Bash', at: '2026-10-16T09:59:30Z',
    }));
    const floor = deskFloor(root, new ActivityRegistry(), new Date('2026-10-16T10:00:00Z'));
    assert.deepEqual(floor.zones[0].rooms[0].agents.map((a) => [a.tool, a.state, a.detail]), [['codex', 'running', 'Bash']]);
  });

  it('builds the floor from the registry, the clocks, and the host', () => {
    const activity = new ActivityRegistry();
    activity.set('alpha', 'reading', 'read_file');
    const floor = deskFloor(root, activity, new Date('2026-10-16T10:00:00Z'));
    const agents = floor.zones[0].rooms[0].agents;
    assert.deepEqual(agents.map((a) => [a.tool, a.state]), [['codex', 'working'], ['agent-control', 'reading']]);
  });

  it('answers the project collections, and only open runs give tasks', () => {
    const floor = deskFloor(root, new ActivityRegistry(), new Date('2026-10-16T10:00:00Z'));
    const read = (name: Parameters<typeof readCollection>[1]) => readCollection(root, name, 'alpha', floor);
    assert.deepEqual(read('memory').map((r) => [r.name, r.excerpt]), [['active', 'Shipping the export.']]);
    assert.deepEqual(read('notes').map((r) => r.name), ['idea']);
    assert.deepEqual(read('runs').map((r) => [r.title, r.state]), [['Add export', 'in progress'], ['2026-10-01-090000-dev-x-old-work', 'done']]);
    assert.deepEqual(read('tasks').map((r) => [r.task, r.status, r.run]), [['CSV writer', 'in_progress', 'Add export']]);
    const plan = join(root, 'ctx', 'runs', 'alpha', '2026-10-16-090000-dev-x-add-export', 'plan.md');
    const stat = statSync(plan, { bigint: true });
    assert.deepEqual([read('tasks')[0].runId, read('tasks')[0].revision],
      ['2026-10-16-090000-dev-x-add-export', `mtime:${stat.mtimeNs}:size:${stat.size}`]);
    assert.deepEqual(readCollection(root, 'projects', undefined, floor).map((r) => [r.key, r.agents]), [['alpha', 1]]);
  });

  it('refuses a project collection without a project, and a bad key', () => {
    const floor = deskFloor(root, new ActivityRegistry());
    assert.throws(() => readCollection(root, 'runs', undefined, floor), /needs a project/);
    assert.throws(() => readCollection(root, 'runs', '../x', floor), /invalid project key/);
  });
});
