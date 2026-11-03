import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT, boxFaces, faceX, faceY, localFrame, project, segment, viewBounds } from './voxel';

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

test('a frame facing +y keeps world axes; facing +x mirrors across the diagonal', () => {
  assert.deepEqual(localFrame([2, 3, 0], 'y').at(1, 0.5, 2), [3, 3.5, 2]);
  assert.deepEqual(localFrame([2, 3, 0], 'x').at(1, 0.5, 2), [2.5, 4, 2]);
  assert.deepEqual(localFrame([0, 0, 0], 'x').box([0, 0, 0], [1, 2, 1]), boxFaces([0, 0, 0], [2, 1, 1]));
});

test('front and side decals sit on the box faces turned toward the viewer, either way it faces', () => {
  for (const facing of ['x', 'y'] as const) {
    const frame = localFrame([4, 6, 0], facing);
    const faces = frame.box([-1, -1, 0], [1, 1, 2]);
    const turned = [faces.left, faces.right];
    assert.ok(turned.includes(frame.front(1, -1, 1, 0, 2)), `${facing}: front decal on a visible face`);
    assert.ok(turned.includes(frame.side(1, -1, 1, 0, 2)), `${facing}: side decal on a visible face`);
  }
});

test('view bounds enclose every projected corner with the requested padding', () => {
  assert.deepEqual(viewBounds([[0, 0, 0], [0, 0, 1]], 2), { x: -2, y: -UNIT - 2, width: 4, height: UNIT + 4 });
  const cube = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z] as const)));
  assert.deepEqual(viewBounds(cube, 0), { x: -UNIT, y: -UNIT, width: UNIT * 2, height: UNIT * 2 });
});
