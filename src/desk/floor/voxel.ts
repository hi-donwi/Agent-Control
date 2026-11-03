/**
 * A small isometric voxel renderer for the floor scenes. Space is measured in voxels: x runs
 * left-down on screen, y right-down, z up. The viewer looks from above the +x/+y corner, so a
 * box shows its top, its +x face on the left and its +y face on the right. Everything returns
 * SVG point strings; painting order is the caller's (back to front).
 */
export type Vec3 = readonly [x: number, y: number, z: number];

/** Screen pixels per voxel along the horizontal axes; a voxel is UNIT tall. */
export const UNIT = 16;

export interface BoxFaces {
  top: string;
  left: string;
  right: string;
}

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function project([x, y, z]: Vec3): [number, number] {
  return [(y - x) * UNIT, ((x + y) * UNIT) / 2 - z * UNIT];
}

function round(n: number): number {
  // `|| 0` turns -0 into 0, so a coordinate never prints as "-0".
  return Math.round(n * 100) / 100 || 0;
}

export function points(corners: readonly Vec3[]): string {
  return corners.map((corner) => project(corner).map(round).join(',')).join(' ');
}

export function boxFaces([x, y, z]: Vec3, [w, d, h]: Vec3): BoxFaces {
  const x1 = x + w;
  const y1 = y + d;
  const z1 = z + h;
  return {
    top: points([[x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1]]),
    left: faceX(x1, y, y1, z, z1),
    right: faceY(y1, x, x1, z, z1),
  };
}

/** A rectangle on the plane x = `x`, seen from +x (a left-hand face). */
export function faceX(x: number, y0: number, y1: number, z0: number, z1: number): string {
  return points([[x, y0, z1], [x, y1, z1], [x, y1, z0], [x, y0, z0]]);
}

/** A rectangle on the plane y = `y`, seen from +y (a right-hand face). */
export function faceY(y: number, x0: number, x1: number, z0: number, z1: number): string {
  return points([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]]);
}

/** A rectangle on the plane z = `z`, seen from above. */
export function faceZ(z: number, x0: number, x1: number, y0: number, y1: number): string {
  return points([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);
}

/** Which way something faces: toward +y (screen lower right) or +x (screen lower left). */
export type Facing = 'x' | 'y';

/**
 * Local coordinates for a piece that faces a way: u runs across it, v forward, z up. Facing +x
 * mirrors facing +y across the floor's diagonal, so every face turned toward the viewer stays
 * turned toward the viewer.
 */
export interface Frame {
  at(u: number, v: number, z: number): Vec3;
  box(from: Vec3, to: Vec3): BoxFaces;
  /** A rectangle on the plane v = `v`, seen from the front. */
  front(v: number, u0: number, u1: number, z0: number, z1: number): string;
  /** A rectangle on the plane u = `u`, seen from the side turned toward the viewer. */
  side(u: number, v0: number, v1: number, z0: number, z1: number): string;
}

export function localFrame([ox, oy, oz]: Vec3, facing: Facing): Frame {
  const mirrored = facing === 'x';
  const at = (u: number, v: number, z: number): Vec3 => (mirrored ? [ox + v, oy + u, oz + z] : [ox + u, oy + v, oz + z]);
  return {
    at,
    box(from, to) {
      const a = at(...from);
      const b = at(...to);
      return boxFaces(
        [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
        [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])],
      );
    },
    front: (v, u0, u1, z0, z1) => (mirrored
      ? faceX(ox + v, oy + u0, oy + u1, oz + z0, oz + z1)
      : faceY(oy + v, ox + u0, ox + u1, oz + z0, oz + z1)),
    side: (u, v0, v1, z0, z1) => (mirrored
      ? faceY(oy + u, ox + v0, ox + v1, oz + z0, oz + z1)
      : faceX(ox + u, oy + v0, oy + v1, oz + z0, oz + z1)),
  };
}

/** One straight line as an SVG path fragment. */
export function segment(from: Vec3, to: Vec3): string {
  const [ax, ay] = project(from).map(round);
  const [bx, by] = project(to).map(round);
  return `M${ax} ${ay}L${bx} ${by}`;
}

export function viewBounds(corners: readonly Vec3[], pad: number): ViewBounds {
  const projected = corners.map(project);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x: round(x), y: round(y), width: round(Math.max(...xs) + pad - x), height: round(Math.max(...ys) + pad - y) };
}
