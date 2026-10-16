import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseActivityRecord, readActivityRecords, type ActivityRecord } from './activity-files.js';
import { FRESH_MS, externalAgents } from './agents.js';
import type { OpenClock } from './clocks.js';
import { floorEvents, type FloorEvent } from './stream.js';
import type { Floor } from './floor.js';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const MAX_HOURS = 8;

function record(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return { session: 's1', project: 'alpha', tool: 'claude', state: 'reading', detail: 'Read', atMs: NOW - 30_000, ...over };
}

function clock(over: Partial<OpenClock> = {}): OpenClock {
  return {
    id: 'c1', project: 'alpha', tool: 'claude', actor: 'dev', start: '', note: 'auto',
    startMs: NOW - 3600_000, heartbeatMs: NOW - 10_000, file: '.open-agent-dev-claude-s1.json', ...over,
  };
}

describe('parseActivityRecord', () => {
  const valid = { version: 1, session: 's1', project: 'alpha', tool: 'claude', state: 'typing', detail: 'Edit', at: '2026-10-16T17:00:00+07:00' };

  it('reads a record the framework writes', () => {
    assert.deepEqual(parseActivityRecord(JSON.stringify(valid)), {
      session: 's1', project: 'alpha', tool: 'claude', state: 'typing', detail: 'Edit', atMs: Date.parse(valid.at),
    });
  });

  it('refuses another version, an unknown state, a bad key, or a bad time', () => {
    assert.equal(parseActivityRecord(JSON.stringify({ ...valid, version: 2 })), null);
    assert.equal(parseActivityRecord(JSON.stringify({ ...valid, state: 'offline' })), null);
    assert.equal(parseActivityRecord(JSON.stringify({ ...valid, project: '../x' })), null);
    assert.equal(parseActivityRecord(JSON.stringify({ ...valid, at: 'soon' })), null);
    assert.equal(parseActivityRecord('{'), null);
  });

  it('caps the detail', () => {
    assert.equal(parseActivityRecord(JSON.stringify({ ...valid, detail: 'x'.repeat(500) }))!.detail.length, 120);
  });
});

describe('readActivityRecords', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ac-activity-'));
    mkdirSync(join(root, '.local', 'agent', 'activity'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads one record per session file and ignores a file claiming another session', () => {
    const dir = join(root, '.local', 'agent', 'activity');
    const body = (session: string) => JSON.stringify({ version: 1, session, project: 'alpha', tool: 'claude', state: 'idle', detail: '', at: '2026-10-16T10:00:00Z' });
    writeFileSync(join(dir, 's1.json'), body('s1'));
    writeFileSync(join(dir, 's2.json'), body('someone-else'));
    writeFileSync(join(dir, '.tmp-x.json'), body('s3'));
    assert.deepEqual(readActivityRecords(root).map((r) => r.session), ['s1']);
  });

  it('is empty without the directory', () => {
    assert.deepEqual(readActivityRecords(join(root, 'nowhere')), []);
  });
});

describe('externalAgents', () => {
  const merge = (clocks: OpenClock[], records: ActivityRecord[]) => externalAgents({ clocks, records, nowMs: NOW, maxHours: MAX_HOURS });

  it('shows a clock as presence when no record speaks for it', () => {
    assert.deepEqual(merge([clock()], []).map((a) => [a.id, a.state, a.source]), [['clock:c1', 'working', 'clock']]);
  });

  it('takes the pose from a fresh record for the same session', () => {
    const [agent] = merge([clock()], [record({ state: 'typing', detail: 'Edit' })]);
    assert.deepEqual([agent.state, agent.detail, agent.source], ['typing', 'Edit', 'clock']);
  });

  it('falls back to the clock when the record is stale, but keeps a raised hand up', () => {
    const stale = NOW - FRESH_MS - 1;
    assert.equal(merge([clock()], [record({ atMs: stale })])[0].state, 'working');
    assert.equal(merge([clock()], [record({ state: 'waiting', atMs: stale })])[0].state, 'waiting');
  });

  it('does not match a record of another session or project', () => {
    const agents = merge([clock()], [record({ session: 's9' }), record({ session: 's1', project: 'beta' })]);
    assert.deepEqual(agents.map((a) => [a.id, a.project]), [['clock:c1', 'alpha'], ['activity:s9', 'alpha'], ['activity:s1', 'beta']]);
  });

  it('seats a record without a clock, idle once quiet, gone past the cap', () => {
    const quiet = merge([], [record({ atMs: NOW - FRESH_MS - 1 })]);
    assert.deepEqual(quiet.map((a) => [a.state, a.detail, a.source]), [['idle', 'no recent activity', 'activity']]);
    assert.deepEqual(merge([], [record({ atMs: NOW - MAX_HOURS * 3600_000 - 1 })]), []);
    assert.deepEqual(merge([], [record({ state: 'waiting', atMs: NOW - MAX_HOURS * 3600_000 - 1 })]), []);
  });
});

describe('floorEvents', () => {
  function floor(agents: number, at = 'x'): Floor {
    return { generatedAt: at, zones: [], totals: { projects: 0, agents, active: 0, waiting: 0 } };
  }

  async function collect(floors: Floor[], pingEvery = 2): Promise<FloorEvent[]> {
    let tick = 0;
    const events: FloorEvent[] = [];
    for await (const event of floorEvents({
      read: () => floors[tick],
      sleep: async () => { tick++; },
      stopped: () => tick >= floors.length,
      pingEvery,
    })) events.push(event);
    return events;
  }

  it('sends the first floor, then only changes, ignoring the timestamp', async () => {
    const events = await collect([floor(1, 'a'), floor(1, 'b'), floor(2, 'c')], 10);
    assert.deepEqual(events.map((e) => [e.event, (JSON.parse(e.data) as Floor).totals.agents]), [['floor', 1], ['floor', 2]]);
  });

  it('pings while nothing changes', async () => {
    const events = await collect([floor(1), floor(1), floor(1), floor(1), floor(1)], 2);
    assert.deepEqual(events.map((e) => e.event), ['floor', 'ping', 'ping']);
  });
});
