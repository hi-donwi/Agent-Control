import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME, historyEntry, parseRoute, routeAddress, routeHash, type DeskRoute } from './route';

test('every desk position survives a round trip through the hash', () => {
  const routes: DeskRoute[] = [
    HOME,
    { view: 'floor', level: 'acme', page: 0 },
    { view: 'floor', level: 'acme', page: 2 },
    { view: 'floor', level: '-', page: 1 },
    { view: 'floor', level: 'north & south', page: 0 },
    { view: 'project', key: 'billing-api' },
    { view: 'pm', page: 'today' },
    { view: 'pm', page: 'timeline' },
    { view: 'client', client: 'globex/eu' },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(routeHash(route)), route, routeHash(route));
});

test('the hash reads pages from one, and the home floor has no hash', () => {
  assert.equal(routeHash(HOME), '');
  assert.equal(routeHash({ view: 'floor', level: 'acme', page: 2 }), '#/level/acme/3');
  assert.deepEqual(parseRoute('#/level/acme/3'), { view: 'floor', level: 'acme', page: 2 });
  assert.deepEqual(parseRoute('#/level/acme/1'), { view: 'floor', level: 'acme', page: 0 });
});

test('an address the desk does not know opens the home floor', () => {
  for (const hash of ['', '#', '#/', '#/level', '#/level/', '#/project', '#/nowhere', '#/today/extra', '#/constructor', '#/toString']) {
    assert.deepEqual(parseRoute(hash), HOME, hash);
  }
  assert.deepEqual(parseRoute('#/level/acme/zero'), { view: 'floor', level: 'acme', page: 0 });
  assert.deepEqual(parseRoute('#/project/%E0%A4%A'), { view: 'project', key: '%E0%A4%A' });
});

test('walking the floor stays one history entry; every other view is its own', () => {
  assert.equal(historyEntry(HOME), historyEntry({ view: 'floor', level: 'acme', page: 3 }));
  assert.notEqual(historyEntry({ view: 'project', key: 'a' }), historyEntry({ view: 'project', key: 'b' }));
  assert.notEqual(historyEntry({ view: 'pm', page: 'today' }), historyEntry({ view: 'pm', page: 'backlog' }));
  assert.notEqual(historyEntry(HOME), historyEntry({ view: 'client', client: 'acme' }));
});

test('leaving a project room drops the visual context selection, and keeps every other parameter', () => {
  const room: DeskRoute = { view: 'project', key: 'billing' };
  assert.equal(routeAddress(room, '?project=billing&view=modules'), '?project=billing&view=modules#/project/billing');
  assert.equal(routeAddress(HOME, '?project=billing&view=modules&node=n1'), '');
  assert.equal(routeAddress({ view: 'pm', page: 'today' }, '?ui=classic&project=billing&module=m'), '?ui=classic#/today');
  assert.equal(routeAddress(HOME, '?token=abc'), '?token=abc');
});
