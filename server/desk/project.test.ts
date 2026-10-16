import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseActive, parseDecisions, parseLog, projectDetail } from './project.js';
import { setTaskBlocked } from './tasks.js';
import { ActivityRegistry, deskFloor } from './index.js';
import type { WsInputRunner } from './ws-input.js';

const ACTIVE = `# alpha — active

- **Updated:** 2026-10-16
- **Stage:** Export in progress
- **Current focus:** CSV writer, then the route

## Next up

- Wire the export route
- Ask legal about retention

## Blocked on

| Item | Waiting for | Since |
|---|---|---|
| Vendor API keys | client IT | 2026-10-14 |
| None | - | - |
`;

describe('memory parsers', () => {
  it('reads stage, focus, next up, and the blocked-on table', () => {
    assert.deepEqual(parseActive(ACTIVE), {
      updated: '2026-10-16',
      stage: 'Export in progress',
      focus: 'CSV writer, then the route',
      nextUp: ['Wire the export route', 'Ask legal about retention'],
      blockedOn: [{ item: 'Vendor API keys', waitingFor: 'client IT', since: '2026-10-14' }],
    });
  });

  it('treats the template placeholders as empty', () => {
    const empty = parseActive('- **Stage:** \n\n## Next up\n\n-\n\n## Blocked on\n\n| Item | Waiting for | Since |\n|---|---|---|\n');
    assert.deepEqual([empty.stage, empty.nextUp, empty.blockedOn], ['', [], []]);
  });

  it('reads decisions from a table or from headings, and log milestones', () => {
    assert.deepEqual(parseDecisions('| Date | Decision | Why | ADR |\n|---|---|---|---|\n| 2026-10-01 | CSV first | simplest | - |\n'),
      [{ date: '2026-10-01', title: 'CSV first' }]);
    assert.deepEqual(parseDecisions('# d\n\n## 2026-10-02 16:45 +0700 — Use the gateway\n'),
      [{ date: '2026-10-02', title: 'Use the gateway' }]);
    assert.deepEqual(parseLog('| Date | Milestone |\n|---|---|\n| 2026-10-15 | Started (dev) |\n| 2026-10-16 | Shipped (dev) |\n'),
      [{ date: '2026-10-15', text: 'Started (dev)' }, { date: '2026-10-16', text: 'Shipped (dev)' }]);
  });
});

describe('projectDetail', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ac-room-'));
    const ctx = join(root, 'context');
    mkdirSync(join(ctx, 'memory', 'projects', 'alpha', 'notes'), { recursive: true });
    mkdirSync(join(ctx, 'clients', 'acme'), { recursive: true });
    mkdirSync(join(ctx, 'tasks', 'alpha'), { recursive: true });
    mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
    writeFileSync(join(ctx, 'registry.tsv'), 'key\tclient\tgroup\tfolder\tdescription\nalpha\tacme\t-\tprojects/acme/alpha\tBilling API\n');
    writeFileSync(join(ctx, 'clients', 'acme', 'client.md'), '# acme\n');
    writeFileSync(join(ctx, 'memory', 'projects', 'alpha', 'active.md'), ACTIVE);
    writeFileSync(join(ctx, 'memory', 'projects', 'alpha', 'notes', '2026-10-16-idea.md'), '# Idea\n\nTry CSV.\n');
    writeFileSync(join(ctx, 'tasks', 'alpha', 'task_keys.md'),
      '---\nschema_version: 1\nid: task_keys\nproject: alpha\ntitle: Get the keys\nstatus: ready\npriority: high\nowner: dev\nblocked: true\nblocked_reason: "waits on \\"client\\" IT"\nupdated_at: 2026-10-16T10:00:00+07:00\n---\n');
    writeFileSync(join(root, '.local', 'agent', 'policies', 'alpha.json'),
      JSON.stringify({ schema_version: 1, default: 'approval-required', actions: { inspect: 'read' }, llm: { endpoints: ['brain'] } }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('gathers memory, work, blockers, and context for one project', () => {
    const detail = projectDetail(root, 'alpha', deskFloor(root, new ActivityRegistry()));
    assert.equal(detail.client, 'acme');
    assert.equal(detail.description, 'Billing API');
    assert.equal(detail.memory.stage, 'Export in progress');
    assert.equal(detail.memory.blockedOn.length, 1);
    assert.deepEqual(detail.memory.notes.map((n) => n.name), ['Idea']);
    assert.deepEqual(detail.tasks.map((t) => [t.id, t.blocked, t.blockedReason]), [['task_keys', 'yes', 'waits on "client" IT']]);
    assert.deepEqual(detail.context.pack, ['context/clients/acme/client.md', 'context/memory/projects/alpha/active.md']);
    assert.deepEqual(detail.context.policy, { default: 'approval-required', actions: 1, endpoints: ['brain'] });
  });

  it('refuses an unknown or invalid project', () => {
    const floor = deskFloor(root, new ActivityRegistry());
    assert.throws(() => projectDetail(root, 'nosuch', floor), /unknown project/);
    assert.throws(() => projectDetail(root, '../x', floor), /invalid project key/);
  });
});

describe('setTaskBlocked', () => {
  const REV = 'mtime:1:size:2';
  it('blocks with a reason and unblocks, through ws task', async () => {
    const calls: string[][] = [];
    const run: WsInputRunner = async (args) => { calls.push(args); return `task task_a ${args[1] === 'block' ? 'blocked' : 'unblocked'} ${REV}\n`; };
    await setTaskBlocked(run, { project: 'alpha', id: 'task_a', reason: ' waits  on keys ', revision: REV }, true);
    await setTaskBlocked(run, { project: 'alpha', id: 'task_a', revision: REV }, false);
    assert.deepEqual(calls, [
      ['task', 'block', 'alpha', 'task_a', 'waits on keys', '--revision', REV],
      ['task', 'unblock', 'alpha', 'task_a', '--revision', REV],
    ]);
  });

  it('needs a reason to block', async () => {
    await assert.rejects(setTaskBlocked(async () => '', { project: 'alpha', id: 'task_a', reason: ' ', revision: REV }, true), /what blocks/);
  });
});
