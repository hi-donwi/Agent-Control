import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLastActive, zoneLabel } from './FloorView';
import type { Floor, FloorZone } from '../types';

describe('floor-filters and helpers', () => {
  it('formats zoneLabel correctly for standard and unregistered clients', () => {
    assert.equal(zoneLabel('acme'), 'acme');
    assert.equal(zoneLabel('-'), 'unregistered');
  });

  it('formats formatLastActive across recent, hours, days, and missing timestamps', () => {
    assert.equal(formatLastActive(null), 'no recorded activity');
    assert.equal(formatLastActive(undefined), 'no recorded activity');
    assert.equal(formatLastActive('invalid'), 'no recorded activity');

    const now = Date.now();
    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
    assert.equal(formatLastActive(tenMinAgo), 'just now');

    const threeHoursAgo = new Date(now - 3 * 3600 * 1000).toISOString();
    assert.equal(formatLastActive(threeHoursAgo), '3h ago');

    const twoDaysAgo = new Date(now - 49 * 3600 * 1000).toISOString();
    assert.match(formatLastActive(twoDaysAgo), /^2d ago \(\d{4}-\d{2}-\d{2}\)$/);
  });

  it('filters zones and rooms according to active vs all, search, client, and project filters', () => {
    const mockFloor: Floor = {
      generatedAt: '2026-10-17T12:00:00Z',
      totals: { projects: 4, agents: 1, active: 1, waiting: 0, activeProjects: 2, idleProjects: 2 },
      zones: [
        {
          client: 'acme',
          idle: false,
          rooms: [
            {
              key: 'acme-billing',
              group: 'finance',
              description: 'Payment gateway',
              agents: [],
              pendingApprovals: 0,
              codingSession: false,
              lastActiveAt: '2026-10-17T11:00:00Z',
              idle: false,
              idleDays: 0,
            },
            {
              key: 'acme-legacy',
              group: 'legacy',
              description: 'Old billing system',
              agents: [],
              pendingApprovals: 0,
              codingSession: false,
              lastActiveAt: '2026-10-01T00:00:00Z',
              idle: true,
              idleDays: 16,
            },
          ],
        },
        {
          client: 'globex',
          idle: true,
          rooms: [
            {
              key: 'globex-crm',
              group: 'sales',
              description: 'Salesforce sync',
              agents: [],
              pendingApprovals: 0,
              codingSession: false,
              lastActiveAt: '2026-10-05T00:00:00Z',
              idle: true,
              idleDays: 12,
            },
          ],
        },
        {
          client: 'initech',
          idle: false,
          rooms: [
            {
              key: 'initech-app',
              group: 'core',
              description: 'Mobile app backend',
              agents: [],
              pendingApprovals: 0,
              codingSession: false,
              lastActiveAt: '2026-10-17T10:00:00Z',
              idle: false,
              idleDays: 0,
            },
          ],
        },
      ],
    };

    function filterFloor(floor: Floor, options: {
      filterMode: 'active' | 'all';
      search?: string;
      focusClient?: string | null;
      selectedProject?: string | null;
    }): FloorZone[] {
      const q = (options.search ?? '').trim().toLowerCase();
      return floor.zones
        .filter((zone) => !options.focusClient || zone.client === options.focusClient)
        .map((zone) => {
          const rooms = zone.rooms.filter((room) => {
            if (options.selectedProject && room.key !== options.selectedProject) return false;
            if (q) {
              const matchKey = room.key.toLowerCase().includes(q);
              const matchDesc = room.description?.toLowerCase().includes(q);
              const matchGroup = room.group?.toLowerCase().includes(q);
              const matchClient = zone.client.toLowerCase().includes(q);
              if (!matchKey && !matchDesc && !matchGroup && !matchClient) return false;
            }
            if (options.filterMode === 'active' && !options.selectedProject && !q) {
              if (room.idle) return false;
            }
            return true;
          });
          return { ...zone, rooms };
        })
        .filter((zone) => zone.rooms.length > 0);
    }

    // Default 'active' mode: hides globex completely (all its rooms are idle), hides acme-legacy
    const activeOnly = filterFloor(mockFloor, { filterMode: 'active' });
    assert.deepEqual(activeOnly.map((z) => [z.client, z.rooms.map((r) => r.key)]), [
      ['acme', ['acme-billing']],
      ['initech', ['initech-app']],
    ]);

    // 'all' mode: includes all zones and rooms, even idle ones
    const all = filterFloor(mockFloor, { filterMode: 'all' });
    assert.deepEqual(all.map((z) => [z.client, z.rooms.map((r) => r.key)]), [
      ['acme', ['acme-billing', 'acme-legacy']],
      ['globex', ['globex-crm']],
      ['initech', ['initech-app']],
    ]);

    // Client filter: focus on 'acme' in active mode
    const acmeActive = filterFloor(mockFloor, { filterMode: 'active', focusClient: 'acme' });
    assert.deepEqual(acmeActive.map((z) => [z.client, z.rooms.map((r) => r.key)]), [
      ['acme', ['acme-billing']],
    ]);

    // Project filter: pick specific project 'acme-legacy'
    const specificProj = filterFloor(mockFloor, { filterMode: 'active', selectedProject: 'acme-legacy' });
    assert.deepEqual(specificProj.map((z) => [z.client, z.rooms.map((r) => r.key)]), [
      ['acme', ['acme-legacy']],
    ]);

    // Search: query for 'sync' (matching description of globex-crm)
    const searchResult = filterFloor(mockFloor, { filterMode: 'active', search: 'sync' });
    assert.deepEqual(searchResult.map((z) => [z.client, z.rooms.map((r) => r.key)]), [
      ['globex', ['globex-crm']],
    ]);
  });
});
