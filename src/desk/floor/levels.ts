import { UNREGISTERED_ZONE, type ActivityState, type FloorRoom, type FloorZone } from '../types';

/**
 * The floor as a building: one client per level, one screen per level. Levels keep a fixed
 * order (clients alphabetically from the top, unregistered projects on the ground floor), so a
 * client keeps its level number and its look however activity moves.
 */
export function levelOrder(zones: readonly FloorZone[]): string[] {
  return zones
    .map((zone) => zone.client)
    .sort((a, b) => Number(a === UNREGISTERED_ZONE) - Number(b === UNREGISTERED_ZONE) || a.localeCompare(b));
}

/** Level numbers from the ground up, for clients listed from the top down. */
export function storeyLevels(clients: readonly string[]): Map<string, number> {
  return new Map(clients.map((client, index) => [client, clients.length - index]));
}

const QUIET: ReadonlySet<ActivityState> = new Set(['idle', 'offline']);

/** Active: recorded activity within the last day, or an agent at work right now. */
export function isActiveRoom(room: FloorRoom): boolean {
  return !room.idle || room.agents.some((agent) => !QUIET.has(agent.state));
}

function urgency(room: FloorRoom): number {
  if (room.pendingApprovals > 0 || room.agents.some((agent) => agent.state === 'waiting' || agent.state === 'warning')) return 0;
  if (room.agents.some((agent) => !QUIET.has(agent.state))) return 1;
  if (room.agents.length > 0) return 2;
  return 3;
}

const lastActive = (room: FloorRoom) => Date.parse(room.lastActiveAt ?? '') || 0;

/** Projects that need you first, then those at work, then those with agents, then by latest activity. */
export function sortRooms(rooms: readonly FloorRoom[]): FloorRoom[] {
  return [...rooms].sort((a, b) => urgency(a) - urgency(b) || lastActive(b) - lastActive(a) || a.key.localeCompare(b.key));
}

export interface LevelPage {
  rooms: FloorRoom[];
  active: boolean;
}

/** A level's pages: active projects first, then inactive ones, which always start a page of their own. */
export function levelPages(rooms: readonly FloorRoom[], perPage: number): LevelPage[] {
  const sorted = sortRooms(rooms);
  const chunk = (list: FloorRoom[], active: boolean): LevelPage[] => Array.from(
    { length: Math.ceil(list.length / perPage) },
    (_, index) => ({ rooms: list.slice(index * perPage, (index + 1) * perPage), active }),
  );
  const pages = [...chunk(sorted.filter(isActiveRoom), true), ...chunk(sorted.filter((room) => !isActiveRoom(room)), false)];
  return pages.length > 0 ? pages : [{ rooms: [], active: false }];
}

/** The page a project's table is on within its level. */
export function pageOf(rooms: readonly FloorRoom[], key: string, perPage: number): number {
  const index = levelPages(rooms, perPage).findIndex((page) => page.rooms.some((room) => room.key === key));
  return Math.max(0, index);
}

export interface ProjectMatch {
  client: string;
  room: FloorRoom;
}

/** Projects whose key, description, group, client, or agents match `query`, across every level. */
export function searchProjects(zones: readonly FloorZone[], query: string): ProjectMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return zones.flatMap((zone) => zone.rooms
    .filter((room) => [room.key, room.description, room.group, zone.client, ...room.agents.flatMap((agent) => [agent.tool, agent.detail])]
      .some((text) => text?.toLowerCase().includes(q)))
    .map((room) => ({ client: zone.client, room })));
}

export interface Move {
  axis: 'level' | 'page';
  step: -1 | 1;
}

/** Up and down walk the levels (up is toward the top floor), left and right the project pages. */
export function moveFor(key: string): Move | null {
  switch (key) {
    case 'ArrowUp':
    case 'PageUp':
      return { axis: 'level', step: -1 };
    case 'ArrowDown':
    case 'PageDown':
      return { axis: 'level', step: 1 };
    case 'ArrowLeft':
      return { axis: 'page', step: -1 };
    case 'ArrowRight':
      return { axis: 'page', step: 1 };
    default:
      return null;
  }
}
