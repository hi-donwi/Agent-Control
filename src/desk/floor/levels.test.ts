import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelOrder, levelPages, moveFor, pageOf, searchProjects, sortRooms, storeyLevels } from './levels';
import type { ActivityState, FloorRoom, FloorZone } from '../types';

function room(key: string, options: { idle?: boolean; at?: string; agents?: ActivityState[]; approvals?: number; description?: string } = {}): FloorRoom {
  return {
    key,
    group: '-',
    description: options.description ?? '',
    agents: (options.agents ?? []).map((state, index) => ({
      id: `${key}:${index}`, tool: index ? 'codex' : 'claude', project: key, state, detail: '', since: '2026-11-03T10:00:00Z', source: 'clock',
    })),
    pendingApprovals: options.approvals ?? 0,
    codingSession: false,
    lastActiveAt: options.at ?? null,
    idle: options.idle ?? false,
  };
}

const zone = (client: string, rooms: FloorRoom[]): FloorZone => ({ client, rooms });

test('levels keep a fixed order: clients alphabetically from the top, unregistered on the ground floor', () => {
  const order = levelOrder([zone('globex', []), zone('-', []), zone('acme', [])]);
  assert.deepEqual(order, ['acme', 'globex', '-']);
  assert.deepEqual([...storeyLevels(order)], [['acme', 3], ['globex', 2], ['-', 1]]);
});

test('tables put projects that need you first, then those at work, then by latest activity', () => {
  const sorted = sortRooms([
    room('quiet', { at: '2026-11-03T09:00:00Z' }),
    room('recent', { at: '2026-11-03T11:00:00Z' }),
    room('resting', { agents: ['idle'] }),
    room('working', { agents: ['typing'] }),
    room('approvals', { approvals: 1 }),
    room('asking', { agents: ['waiting'] }),
  ]);
  assert.deepEqual(sorted.map((entry) => entry.key), ['approvals', 'asking', 'working', 'resting', 'recent', 'quiet']);
});

test('a level pages its active projects first, and inactive ones always start a page of their own', () => {
  const rooms = [
    ...['a1', 'a2', 'a3'].map((key) => room(key)),
    ...['i1', 'i2', 'i3', 'i4', 'i5'].map((key) => room(key, { idle: true })),
    room('idle-but-working', { idle: true, agents: ['running'] }),
  ];
  const pages = levelPages(rooms, 2);
  assert.deepEqual(pages.map((page) => [page.active, page.rooms.map((entry) => entry.key)]), [
    [true, ['idle-but-working', 'a1']],
    [true, ['a2', 'a3']],
    [false, ['i1', 'i2']],
    [false, ['i3', 'i4']],
    [false, ['i5']],
  ]);
  assert.equal(pageOf(rooms, 'i3', 2), 3);
  assert.equal(pageOf(rooms, 'missing', 2), 0);
  assert.deepEqual(levelPages([], 6), [{ rooms: [], active: false }]);
});

test('search finds projects across every level by key, description, client, or agent', () => {
  const zones = [
    zone('acme', [room('billing', { description: 'Payment gateway' }), room('crm', { agents: ['typing'] })]),
    zone('globex', [room('portal')]),
  ];
  const keys = (query: string) => searchProjects(zones, query).map((match) => `${match.client}/${match.room.key}`);
  assert.deepEqual(keys('gateway'), ['acme/billing']);
  assert.deepEqual(keys('GLOBEX'), ['globex/portal']);
  assert.deepEqual(keys('claude'), ['acme/crm']);
  assert.deepEqual(keys('  '), []);
});

test('up and down walk the levels, left and right the project pages', () => {
  assert.deepEqual(moveFor('ArrowUp'), { axis: 'level', step: -1 });
  assert.deepEqual(moveFor('PageDown'), { axis: 'level', step: 1 });
  assert.deepEqual(moveFor('ArrowLeft'), { axis: 'page', step: -1 });
  assert.deepEqual(moveFor('ArrowRight'), { axis: 'page', step: 1 });
  assert.equal(moveFor('Enter'), null);
});
