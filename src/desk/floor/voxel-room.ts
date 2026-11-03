import type { ActivityState } from '../types';
import { project, viewBounds, type Vec3 } from './voxel';

/**
 * One project room in voxels: x runs along the long window wall, y along the lift wall, and
 * the walls and floor slab are `wall` and `slab` thick outside that box.
 */
export const ROOM = { w: 14, d: 8, h: 6, wall: 0.5, slab: 0.9 } as const;

/** Desks a room shows; agents beyond these keep their seat controls but no desk. */
export const MAX_DESKS = 3;

const DESK_X = [3, 7.3, 11.6] as const;
const SEAT_Y = 2.1;
/** Height of the name plate anchor: above a raised hand and the antenna light. */
const PLATE_Z = 5.9;
/** The middle desk reads best, so the first agent sits there. */
const SEAT_ORDER = [1, 0, 2] as const;

export const ROOM_VIEW = viewBounds(
  [-ROOM.wall, ROOM.w].flatMap((x) => [-ROOM.wall, ROOM.d].flatMap((y) => [-ROOM.slab, ROOM.h].map((z): Vec3 => [x, y, z]))),
  6,
);

export interface DeskSlot {
  /** Where the agent sits: the centre of its chair on the floor. */
  seat: Vec3;
  /** Where its name plate hangs, as a percentage of the room view. */
  plate: { left: number; top: number };
}

const DESK_SLOTS: readonly DeskSlot[] = DESK_X.map((x) => {
  const [px, py] = project([x, SEAT_Y, PLATE_Z]);
  const percent = (n: number) => Math.round(n * 1000) / 10;
  return {
    seat: [x, SEAT_Y, 0],
    plate: { left: percent((px - ROOM_VIEW.x) / ROOM_VIEW.width), top: percent((py - ROOM_VIEW.y) / ROOM_VIEW.height) },
  };
});

/** Desk slots back to front, the order they are painted in. */
export function deskSlots(): readonly DeskSlot[] {
  return DESK_SLOTS;
}

/** The desk slot of each of the first `count` agents. */
export function seatSlots(count: number): number[] {
  return SEAT_ORDER.slice(0, Math.min(count, MAX_DESKS));
}

/**
 * Clients as storeys, numbered from the ground up over the full client list, so a filter
 * that hides some storeys never renumbers the others.
 */
export function storeyLevels(clients: readonly string[]): Map<string, number> {
  return new Map(clients.map((client, index) => [client, clients.length - index]));
}

export interface Pose {
  arms: 'rest' | 'desk' | 'type' | 'hold' | 'chin' | 'raised';
  prop: 'none' | 'page' | 'book';
  screen: 'off' | 'standby' | 'code' | 'doc' | 'terminal' | 'alert';
  marker: 'none' | 'busy' | 'thought' | 'spark' | 'attention' | 'warning' | 'sleep';
  awake: boolean;
}

/** A pose never lies: each recorded state draws its own, and only `waiting` raises a hand. */
const POSES: Record<ActivityState, Pose> = {
  idle: { arms: 'rest', prop: 'none', screen: 'standby', marker: 'none', awake: true },
  working: { arms: 'desk', prop: 'none', screen: 'code', marker: 'busy', awake: true },
  thinking: { arms: 'chin', prop: 'none', screen: 'code', marker: 'thought', awake: true },
  reading: { arms: 'hold', prop: 'page', screen: 'doc', marker: 'none', awake: true },
  typing: { arms: 'type', prop: 'none', screen: 'code', marker: 'none', awake: true },
  running: { arms: 'desk', prop: 'none', screen: 'terminal', marker: 'none', awake: true },
  learning: { arms: 'hold', prop: 'book', screen: 'doc', marker: 'spark', awake: true },
  waiting: { arms: 'raised', prop: 'none', screen: 'standby', marker: 'attention', awake: true },
  warning: { arms: 'rest', prop: 'none', screen: 'alert', marker: 'warning', awake: true },
  offline: { arms: 'rest', prop: 'none', screen: 'off', marker: 'sleep', awake: false },
};

export function poseFor(state: ActivityState): Pose {
  return POSES[state];
}
