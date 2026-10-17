import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFloor, type FloorAgent, type FloorInput } from './floor.js';

const NOW = new Date('2026-10-16T10:00:00Z');

function ext(over: Partial<FloorAgent>): FloorAgent {
  return {
    id: 'clock:c1', tool: 'claude-code', project: 'alpha-api', state: 'working',
    detail: 'fix login', since: '2026-10-16T09:00:00.000Z', source: 'clock', ...over,
  };
}

function input(over: Partial<FloorInput> = {}): FloorInput {
  return {
    registry: [
      { key: 'alpha-api', client: 'acme', group: '-', folder: 'projects/acme/api', description: 'Billing API' },
      { key: 'alpha-web', client: 'acme', group: 'web', folder: 'projects/acme/web', description: '' },
      { key: 'own-tool', client: 'own', group: '-', folder: 'projects/own/tool', description: '' },
    ],
    external: [],
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
    assert.deepEqual(floor.totals, { projects: 3, agents: 0, active: 0, waiting: 0, idleProjects: 3, activeProjects: 0 });
  });

  it('seats an outside agent in its room as it was given', () => {
    const floor = buildFloor(input({ external: [ext({})] }), NOW);
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
    const floor = buildFloor(input({ external: [ext({ project: 'workspace', state: 'idle' })] }), NOW);
    const last = floor.zones.at(-1)!;
    assert.equal(last.client, '-');
    assert.deepEqual(last.rooms.map((r) => r.key), ['workspace']);
  });

  it('orders busy zones and rooms first, and marks coding sessions', () => {
    const floor = buildFloor(input({
      external: [ext({ project: 'own-tool' })],
      codingSessions: new Set(['alpha-web', 'not-registered']),
    }), NOW);
    assert.deepEqual(floor.zones.map((z) => z.client), ['own', 'acme']);
    assert.equal(floor.zones[1].rooms.find((r) => r.key === 'alpha-web')!.codingSession, true);
    assert.equal(floor.zones.flatMap((z) => z.rooms).some((r) => r.key === 'not-registered'), false);
  });

  it('distinguishes active and idle projects and marks zones accordingly', () => {
    const floor = buildFloor(input({
      lastActive: {
        'alpha-api': '2026-10-16T08:00:00Z', // 2 hours ago -> active
        'alpha-web': '2026-10-14T08:00:00Z', // 2 days ago -> idle
        'own-tool': '2026-10-10T08:00:00Z',  // 6 days ago -> idle
      },
    }), NOW);
    const acme = floor.zones.find((z) => z.client === 'acme')!;
    const own = floor.zones.find((z) => z.client === 'own')!;

    const alphaApi = acme.rooms.find((r) => r.key === 'alpha-api')!;
    const alphaWeb = acme.rooms.find((r) => r.key === 'alpha-web')!;
    const ownTool = own.rooms.find((r) => r.key === 'own-tool')!;

    assert.equal(alphaApi.idle, false);
    assert.equal(alphaWeb.idle, true);
    assert.equal(ownTool.idle, true);

    // Acme has at least 1 active room -> acme.idle is false
    assert.equal(acme.idle, false);
    // Own has all idle rooms -> own.idle is true
    assert.equal(own.idle, true);

    assert.equal(floor.totals.activeProjects, 1);
    assert.equal(floor.totals.idleProjects, 2);
  });

  it('keeps room active when an agent or coding session is running even if lastActive is old', () => {
    const floor = buildFloor(input({
      lastActive: { 'alpha-api': '2026-10-01T00:00:00Z' },
      codingSessions: new Set(['alpha-api']),
    }), NOW);
    const alphaApi = floor.zones.flatMap((z) => z.rooms).find((r) => r.key === 'alpha-api')!;
    assert.equal(alphaApi.idle, false);
  });
});
