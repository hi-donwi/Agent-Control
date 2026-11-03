import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DESKS, ROOM, ROOM_VIEW, deskSlots, poseFor, seatSlots, storeyLevels } from './voxel-room';
import { STATE_LABELS, type ActivityState } from '../types';

const STATES = Object.keys(STATE_LABELS) as ActivityState[];

test('desks stand inside the room and are listed back to front for painting', () => {
  const slots = deskSlots();
  assert.equal(slots.length, MAX_DESKS);
  for (const { seat, plate } of slots) {
    assert.ok(seat[0] > 0 && seat[0] < ROOM.w, `seat x ${seat[0]} inside the room`);
    assert.ok(seat[1] > 0 && seat[1] < ROOM.d, `seat y ${seat[1]} inside the room`);
    assert.ok(plate.left > 0 && plate.left < 100, `plate left ${plate.left}% inside the view`);
    assert.ok(plate.top > 0 && plate.top < 100, `plate top ${plate.top}% inside the view`);
  }
  const depth = slots.map(({ seat }) => seat[0] + seat[1]);
  assert.deepEqual(depth, [...depth].sort((a, b) => a - b));
  assert.ok(ROOM_VIEW.width > 0 && ROOM_VIEW.height > 0);
});

test('name plates over neighbouring desks keep clear of each other', () => {
  const slots = deskSlots();
  for (let i = 1; i < slots.length; i += 1) {
    assert.ok(Math.abs(slots[i]!.plate.left - slots[i - 1]!.plate.left) >= 15);
    assert.ok(Math.abs(slots[i]!.plate.top - slots[i - 1]!.plate.top) >= 8);
  }
});

test('agents take the middle desk first, and only as many desks as there are', () => {
  assert.deepEqual(seatSlots(0), []);
  assert.deepEqual(seatSlots(1), [1]);
  assert.deepEqual(seatSlots(2), [1, 0]);
  assert.deepEqual(seatSlots(3), [1, 0, 2]);
  assert.deepEqual(seatSlots(7), [1, 0, 2]);
});

test('storeys count down from the roof, so filtering never renumbers a client', () => {
  const levels = storeyLevels(['north', 'south', '-']);
  assert.deepEqual([...levels], [['north', 3], ['south', 2], ['-', 1]]);
  assert.equal(storeyLevels([]).size, 0);
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
