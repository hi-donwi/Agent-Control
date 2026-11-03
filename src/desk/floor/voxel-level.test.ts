import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACK, LEVEL_LAYOUTS, LEVEL_THEMES, MAX_SEATS, PITCH, REACH, TABLES_PER_PAGE,
  levelLook, levelPlan, poseFor, tableSeats, type SeatSpot, type TableSlot,
} from './voxel-level';
import { STATE_LABELS, type ActivityState } from '../types';

const STATES = Object.keys(STATE_LABELS) as ActivityState[];
/** One level of each layout. */
const LEVELS = LEVEL_LAYOUTS.map((_, index) => index + 1);

type Rect = [x0: number, x1: number, y0: number, y1: number];

/** The floor a chair, its sitter, and its share of the desk take. */
function footprint({ at: [x, y], facing }: SeatSpot): Rect {
  return facing === 'y'
    ? [x - PITCH / 2, x + PITCH / 2, y - BACK, y + REACH]
    : [x - BACK, x + REACH, y - PITCH / 2, y + PITCH / 2];
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6 && a[2] < b[3] - 1e-6 && b[2] < a[3] - 1e-6;
const fullTable = (slot: TableSlot) => tableSeats(slot, MAX_SEATS).map(footprint);

test('every layout plans a page of tables inside its floor, clear of the back corner and the lift', () => {
  for (const level of LEVELS) {
    const plan = levelPlan(level);
    assert.equal(plan.tables.length, TABLES_PER_PAGE, `${plan.layout}: one slot per table on a page`);
    for (const slot of plan.tables) {
      for (const [x0, x1, y0, y1] of fullTable(slot)) {
        assert.ok(x0 >= 0.5 && x1 <= plan.w - 0.5 && y0 >= 0.5 && y1 <= plan.d - 0.5, `${plan.layout}: chair inside the floor`);
        assert.ok(!overlaps([x0, x1, y0, y1], [0, 1.4, 0, 2.6]), `${plan.layout}: chair clear of the back corner`);
        if (x0 < 1.2) assert.ok(y1 <= plan.lift[0] || y0 >= plan.lift[1], `${plan.layout}: chair clear of the lift door`);
      }
    }
  }
});

test('tables on a level never share floor', () => {
  for (const level of LEVELS) {
    const tables = levelPlan(level).tables.map(fullTable);
    for (let i = 0; i < tables.length; i += 1) {
      for (let j = i + 1; j < tables.length; j += 1) {
        for (const a of tables[i]!) for (const b of tables[j]!) assert.ok(!overlaps(a, b), `level ${level}: tables ${i} and ${j} apart`);
      }
    }
  }
});

test('name plates hang inside the view, top to bottom in table order, clear of each other', () => {
  for (const level of LEVELS) {
    const plates = levelPlan(level).tables.map((slot) => slot.plate);
    for (const plate of plates) assert.ok(plate.left > 0 && plate.left < 100 && plate.top > 0 && plate.top < 100);
    assert.deepEqual(plates.map((plate) => plate.top), plates.map((plate) => plate.top).sort((a, b) => a - b));
    for (let i = 0; i < plates.length; i += 1) {
      for (let j = i + 1; j < plates.length; j += 1) {
        const [a, b] = [plates[i]!, plates[j]!];
        assert.ok(Math.abs(a.left - b.left) >= 10 || Math.abs(a.top - b.top) >= 8, `level ${level}: plates ${i} and ${j} apart`);
      }
    }
  }
});

test('neighbouring levels never look alike, and twelve levels in a row never repeat a look', () => {
  for (let level = 1; level < 30; level += 1) {
    assert.notEqual(levelLook(level).layout, levelLook(level + 1).layout);
    assert.notEqual(levelLook(level).theme, levelLook(level + 1).theme);
  }
  const looks = Array.from({ length: LEVEL_LAYOUTS.length * LEVEL_THEMES.length }, (_, index) => JSON.stringify(levelLook(index + 1)));
  assert.equal(new Set(looks).size, looks.length);
});

test('a table has two chairs at least and four at most; a corner table fills its arms in turn', () => {
  const bench: TableSlot = { kind: 'bench', origin: [10, 5, 0], facing: 'y', plate: { left: 50, top: 50 } };
  assert.equal(tableSeats(bench, 0).length, 2);
  assert.equal(tableSeats(bench, 1).length, 2);
  assert.equal(tableSeats(bench, 3).length, 3);
  assert.equal(tableSeats(bench, 9).length, MAX_SEATS);
  assert.deepEqual(tableSeats(bench, 2).map((seat) => seat.at[0]), [10 - PITCH / 2, 10 + PITCH / 2]);
  const corner: TableSlot = { ...bench, kind: 'corner' };
  assert.deepEqual(tableSeats(corner, 4).map((seat) => seat.facing), ['y', 'x', 'y', 'x']);
});

test('every state has a pose of its own, so a pose never stands in for another state', () => {
  const signatures = STATES.map((state) => JSON.stringify(poseFor(state)));
  assert.equal(new Set(signatures).size, STATES.length);
});

test('only an agent that needs you raises a hand, and an offline one has its screen off', () => {
  for (const state of STATES) {
    const pose = poseFor(state);
    assert.equal(pose.arms === 'raised', state === 'waiting', `${state} raises a hand`);
    assert.equal(pose.marker === 'attention', state === 'waiting', `${state} shows the attention mark`);
    assert.equal(pose.marker === 'warning', state === 'warning', `${state} shows the warning mark`);
  }
  assert.equal(poseFor('offline').screen, 'off');
  assert.equal(poseFor('offline').awake, false);
  assert.equal(poseFor('idle').marker, 'none');
});
