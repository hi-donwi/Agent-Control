import type { ActivityState } from '../types';
import { project, viewBounds, type Facing, type Vec3, type ViewBounds } from './voxel';

/**
 * One client's level as an open-plan voxel office: x runs along the window wall, y along the
 * lift wall. Each project gets a table and its agents sit at the table's chairs. A level shows
 * at most TABLES_PER_PAGE tables at once; the floor shows the rest page by page.
 */
export const TABLES_PER_PAGE = 6;
/** Chairs at one project table; agents beyond them keep their plate controls but no chair. */
export const MAX_SEATS = 4;
/** Table width one chair takes. */
export const PITCH = 2.8;
/** How far a chair's back reaches behind the seat, and the desk's front edge ahead of it. */
export const BACK = 0.95;
export const REACH = 2.2;
export const LEVEL_HEIGHT = 6;
export const WALL = 0.5;
export const SLAB = 0.9;

const BENCH = MAX_SEATS * PITCH;
const AISLE = 2.4;
const ROW = BACK + REACH + AISLE;
/** Seat line of the tables nearest a back wall. */
const NEAR_WALL = 1.9;
/** Floor kept clear in the back corner for its shelf, racks, or coffee counter. */
const CORNER = 2.6;
const BENCH_GAP = 2.8;
const MARGIN = 2;
const CORNER_GAP = 1.6;
const LIFT = 2.2;
/** Height of a table's name plate anchor: above a raised hand and the antenna light. */
const PLATE_Z = 5.9;

export const LEVEL_LAYOUTS = ['rows', 'columns', 'corners', 'staggered'] as const;
export const LEVEL_THEMES = ['atelier', 'library', 'lab'] as const;
export type LevelLayout = typeof LEVEL_LAYOUTS[number];
export type LevelTheme = typeof LEVEL_THEMES[number];

export interface SeatSpot {
  /** The centre of the chair on the floor. */
  at: Vec3;
  facing: Facing;
}

export interface TableSlot {
  /** A bench is one straight row of chairs; a corner table is an L with chairs on both arms. */
  kind: 'bench' | 'corner';
  /** Bench: the middle of its row of chairs. Corner: the chair-side corner of the L. */
  origin: Vec3;
  facing: Facing;
  /** Where its name plate hangs, as a percentage of the level view. */
  plate: { left: number; top: number };
}

export interface LevelPlan {
  layout: LevelLayout;
  theme: LevelTheme;
  w: number;
  d: number;
  view: ViewBounds;
  /** Table slots back to front, so the first project sits furthest up the screen. */
  tables: TableSlot[];
  /** The lift door's span along the lift wall. */
  lift: [number, number];
  /** Window spans along the window wall. */
  windows: [number, number][];
  plants: Vec3[];
  cooler: Vec3 | null;
  rug: [x0: number, x1: number, y0: number, y1: number];
}

/** Neighbouring levels never share a layout or a theme, and twelve levels in a row never repeat both. */
export function levelLook(level: number): { layout: LevelLayout; theme: LevelTheme } {
  const index = Math.max(0, level - 1);
  return { layout: LEVEL_LAYOUTS[index % LEVEL_LAYOUTS.length]!, theme: LEVEL_THEMES[index % LEVEL_THEMES.length]! };
}

/** The chairs of a table with `agents` agents: two at least, so an empty table still reads as one. */
export function tableSeats(slot: TableSlot, agents: number): SeatSpot[] {
  const count = Math.min(MAX_SEATS, Math.max(2, agents));
  const [ox, oy] = slot.origin;
  if (slot.kind === 'corner') {
    const arm = (facing: Facing, k: number): SeatSpot => {
      const along = REACH + PITCH / 2 + k * PITCH;
      return { at: facing === 'y' ? [ox + along, oy, 0] : [ox, oy + along, 0], facing };
    };
    return [arm('y', 0), arm('x', 0), arm('y', 1), arm('x', 1)].slice(0, count);
  }
  return Array.from({ length: count }, (_, k) => {
    const along = (k - (count - 1) / 2) * PITCH;
    return { at: slot.facing === 'y' ? [ox + along, oy, 0] : [ox, oy + along, 0], facing: slot.facing };
  });
}

interface Draft {
  w: number;
  d: number;
  tables: Array<Pick<TableSlot, 'kind' | 'origin' | 'facing'>>;
  lift: [number, number];
  plants: Vec3[];
  cooler: Vec3 | null;
}

const mirror = ([x, y, z]: Vec3): Vec3 => [y, x, z];

/** Benches facing +y in two columns and three rows; staggered rows shift every other row. */
function benchRows(stagger: boolean): Draft {
  const shift = (BENCH + BENCH_GAP) / 2;
  const tables = [0, 1, 2].flatMap((row) => [0, 1].map((column) => ({
    kind: 'bench' as const,
    origin: [CORNER + BENCH / 2 + column * (BENCH + BENCH_GAP) + (stagger && row % 2 ? shift : 0), NEAR_WALL + row * ROW, 0] as Vec3,
    facing: 'y' as const,
  })));
  const w = CORNER + 2 * BENCH + BENCH_GAP + (stagger ? shift : 0) + MARGIN;
  const d = NEAR_WALL + 2 * ROW + REACH + AISLE;
  return {
    w, d, tables,
    lift: [d / 2 - LIFT / 2, d / 2 + LIFT / 2],
    plants: [[0.3, d - 1.6, 0], [w - 1.6, 0.3, 0]],
    cooler: [0.2, d - 3.6, 0],
  };
}

/** The rows turned to face +x: benches run along the lift wall, the lift opens between them. */
function benchColumns(): Draft {
  const rows = benchRows(false);
  const liftMiddle = CORNER + BENCH + BENCH_GAP / 2;
  return {
    w: rows.d,
    d: rows.w,
    tables: rows.tables.map((table) => ({ ...table, origin: mirror(table.origin), facing: 'x' })),
    lift: [liftMiddle - LIFT / 2, liftMiddle + LIFT / 2],
    plants: [[rows.d - 1.6, 0.3, 0], [0.3, rows.w - 1.6, 0]],
    cooler: null,
  };
}

/** L-shaped corner tables in three columns and two rows, chairs on the outside of each L. */
function cornerTables(): Draft {
  const reach = REACH + 2 * PITCH;
  const pitch = BACK + reach + CORNER_GAP;
  const tables = [0, 1].flatMap((row) => [0, 1, 2].map((column) => ({
    kind: 'corner' as const,
    origin: [NEAR_WALL + column * pitch, NEAR_WALL + row * pitch, 0] as Vec3,
    facing: 'y' as const,
  })));
  const w = NEAR_WALL + 2 * pitch + reach + MARGIN;
  const d = NEAR_WALL + pitch + reach + MARGIN;
  // The lift opens between the two rows of corner tables.
  const liftMiddle = (NEAR_WALL + reach + NEAR_WALL + pitch + REACH) / 2;
  return {
    w, d, tables,
    lift: [liftMiddle - LIFT / 2, liftMiddle + LIFT / 2],
    plants: [[w - 1.6, 0.3, 0], [0.3, d - 1.4, 0]],
    cooler: null,
  };
}

function windowSpans(w: number): [number, number][] {
  const [start, end, gap] = [2.4, w - 4, 1.2];
  const count = Math.max(1, Math.round((end - start) / 7.2));
  const width = (end - start - (count - 1) * gap) / count;
  return Array.from({ length: count }, (_, k) => [start + k * (width + gap), start + k * (width + gap) + width]);
}

const percent = (n: number) => Math.round(n * 1000) / 10;

function plan(level: number): LevelPlan {
  const look = levelLook(level);
  const draft = look.layout === 'columns' ? benchColumns()
    : look.layout === 'corners' ? cornerTables()
      : benchRows(look.layout === 'staggered');
  const { w, d } = draft;
  const view = viewBounds(
    [-WALL, w].flatMap((x) => [-WALL, d].flatMap((y) => [-SLAB, LEVEL_HEIGHT].map((z): Vec3 => [x, y, z]))),
    6,
  );
  const tables = draft.tables
    .map((table) => {
      const [ox, oy] = table.origin;
      const anchor: Vec3 = table.kind === 'corner' ? [ox + 1.5, oy + 1.5, PLATE_Z] : [ox, oy, PLATE_Z];
      const [px, py] = project(anchor);
      return { ...table, plate: { left: percent((px - view.x) / view.width), top: percent((py - view.y) / view.height) } };
    })
    .sort((a, b) => a.origin[0] + a.origin[1] - (b.origin[0] + b.origin[1]) || a.plate.left - b.plate.left);
  return {
    ...look,
    w, d, view, tables,
    lift: draft.lift,
    windows: windowSpans(w),
    plants: draft.plants,
    cooler: draft.cooler,
    rug: [w * 0.3, w * 0.7, d * 0.35, d * 0.75],
  };
}

const PLANS = new Map<number, LevelPlan>();

/** The floor plan of level `level` (1 is the ground floor). */
export function levelPlan(level: number): LevelPlan {
  let found = PLANS.get(level);
  if (!found) {
    found = plan(level);
    PLANS.set(level, found);
  }
  return found;
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
