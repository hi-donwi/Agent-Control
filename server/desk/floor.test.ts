import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFloor, type FloorInput } from './floor.js';
import type { OpenClock } from './clocks.js';

const NOW = new Date('2026-10-16T10:00:00Z');

function clock(over: Partial<OpenClock>): OpenClock {
  return {
    id: 'c1', project: 'alpha-api', tool: 'claude-code', actor: 'dev', start: '', note: 'fix login',
    startMs: Date.parse('2026-10-16T09:00:00Z'), heartbeatMs: Date.parse('2026-10-16T09:59:30Z'), ...over,
  };
}

function input(over: Partial<FloorInput> = {}): FloorInput {
  return {
    registry: [
      { key: 'alpha-api', client: 'acme', group: '-', folder: 'projects/acme/api', description: 'Billing API' },
      { key: 'alpha-web', client: 'acme', group: 'web', folder: 'projects/acme/web', description: '' },
      { key: 'own-tool', client: 'own', group: '-', folder: 'projects/own/tool', description: '' },
    ],
    clocks: [],
    host: [],
    approvals: {},
    codingSessions: new Set(),
    ...over,
  };
}

describe('buildFloor', () => {
  it('groups registered projects into one zone per client, empty rooms included', () => {
    const floor = buildFloor(input(), NOW);
    assert.deepEqual(floor.zones.map((z) => [z.client, z.rooms.map((r) => r.key)]), [
      ['acme', ['alpha-api', 'alpha-web']],
      ['own', ['own-tool']],
    ]);
    assert.equal(floor.zones[0].rooms[0].description, 'Billing API');
    assert.deepEqual(floor.totals, { projects: 3, agents: 0, active: 0, waiting: 0 });
  });

  it('seats a clock agent in its room with the state it was given', () => {
    const floor = buildFloor(input({ clocks: [{ clock: clock({}), state: 'working' }] }), NOW);
    const room = floor.zones[0].rooms.find((r) => r.key === 'alpha-api')!;
    assert.deepEqual(room.agents, [{
      id: 'clock:c1', tool: 'claude-code', project: 'alpha-api', state: 'working',
      detail: 'fix login', since: '2026-10-16T09:00:00.000Z', source: 'clock',
    }]);
    assert.equal(floor.totals.active, 1);
  });

  it('raises the host agent\'s hand for a pending approval, even without a chat', () => {
    const floor = buildFloor(input({
      approvals: { 'alpha-web': { count: 2, action: 'run_command', requestedAt: '2026-10-16T09:55:00Z' } },
    }), NOW);
    const room = floor.zones[0].rooms.find((r) => r.key === 'alpha-web')!;
    assert.equal(room.pendingApprovals, 2);
    assert.equal(room.agents.length, 1);
    assert.equal(room.agents[0].tool, 'agent-control');
    assert.equal(room.agents[0].state, 'waiting');
    assert.equal(room.agents[0].detail, 'approval: run_command');
    assert.equal(floor.totals.waiting, 1);
  });

  it('turns an active host agent into a waiting one instead of adding a second', () => {
    const floor = buildFloor(input({
      host: [{ project: 'alpha-api', state: 'typing', detail: 'writing the answer', since: '2026-10-16T09:58:00Z', updatedMs: 0 }],
      approvals: { 'alpha-api': { count: 1, action: 'write_file', requestedAt: '2026-10-16T09:59:00Z' } },
    }), NOW);
    const agents = floor.zones[0].rooms.find((r) => r.key === 'alpha-api')!.agents;
    assert.deepEqual(agents.map((a) => [a.id, a.state, a.detail]), [['host:alpha-api', 'waiting', 'approval: write_file']]);
  });

  it('puts a clock on an unregistered key in a trailing unregistered zone', () => {
    const floor = buildFloor(input({ clocks: [{ clock: clock({ project: 'workspace' }), state: 'idle' }] }), NOW);
    const last = floor.zones.at(-1)!;
    assert.equal(last.client, '-');
    assert.deepEqual(last.rooms.map((r) => r.key), ['workspace']);
  });

  it('orders busy zones and rooms first, and marks coding sessions', () => {
    const floor = buildFloor(input({
      clocks: [{ clock: clock({ project: 'own-tool' }), state: 'working' }],
      codingSessions: new Set(['alpha-web', 'not-registered']),
    }), NOW);
    assert.deepEqual(floor.zones.map((z) => z.client), ['own', 'acme']);
    assert.equal(floor.zones[1].rooms.find((r) => r.key === 'alpha-web')!.codingSession, true);
    assert.equal(floor.zones.flatMap((z) => z.rooms).some((r) => r.key === 'not-registered'), false);
  });
});
