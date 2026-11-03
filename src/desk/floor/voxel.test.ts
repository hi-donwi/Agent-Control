import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT, boxFaces, faceX, faceY, project, segment, viewBounds } from './voxel';

const HALF = UNIT / 2;

test('projects voxel space isometrically: x runs left-down, y right-down, z up', () => {
  assert.deepEqual(project([0, 0, 0]), [0, 0]);
  assert.deepEqual(project([1, 0, 0]), [-UNIT, HALF]);
  assert.deepEqual(project([0, 1, 0]), [UNIT, HALF]);
  assert.deepEqual(project([0, 0, 1]), [0, -UNIT]);
});

test('a box shows its top and the two faces turned toward the viewer', () => {
  const faces = boxFaces([0, 0, 0], [1, 1, 1]);
  assert.equal(faces.top, `0,${-UNIT} ${-UNIT},${-HALF} 0,0 ${UNIT},${-HALF}`);
  assert.equal(faces.left, `${-UNIT},${-HALF} 0,0 0,${UNIT} ${-UNIT},${HALF}`);
  assert.equal(faces.right, `${UNIT},${-HALF} 0,0 0,${UNIT} ${UNIT},${HALF}`);
});

test('decals on a wall plane share the edges of the box face they sit on', () => {
  const faces = boxFaces([0, 0, 0], [1, 1, 1]);
  assert.equal(faceX(1, 0, 1, 0, 1), faces.left);
  assert.equal(faceY(1, 0, 1, 0, 1), faces.right);
  assert.equal(segment([0, 0, 0], [0, 0, 1]), `M0 0L0 ${-UNIT}`);
});

test('coordinates are rounded and never print a negative zero', () => {
  const faces = boxFaces([0.333, -0, 0], [1, 1, 0]);
  assert.ok(!/-0(?![.\d])/.test(`${faces.top} ${faces.left} ${faces.right}`));
  assert.ok(faces.top.split(/[ ,]/).every((n) => /^-?\d+(\.\d{1,2})?$/.test(n)));
});

test('view bounds enclose every projected corner with the requested padding', () => {
  assert.deepEqual(viewBounds([[0, 0, 0], [0, 0, 1]], 2), { x: -2, y: -UNIT - 2, width: 4, height: UNIT + 4 });
  const cube = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z] as const)));
  assert.deepEqual(viewBounds(cube, 0), { x: -UNIT, y: -UNIT, width: UNIT * 2, height: UNIT * 2 });
});
