import { Fragment, type ReactNode } from 'react';
import { toolTone } from './AgentFigure';
import { roomSignal } from './levels';
import { UNIT, boxFaces, faceX, faceY, faceZ, localFrame, project, segment, type BoxFaces, type Frame, type Vec3 } from './voxel';
import {
  BACK, LEVEL_HEIGHT, PITCH, REACH, SLAB, WALL, poseFor, tableSeats,
  type LevelPlan, type LevelTheme, type Pose, type SeatSpot,
} from './voxel-level';
import type { FloorAgent, FloorRoom } from '../types';

/** Wall decor is drawn for the far end of a 14-voxel window wall and moved along to the real one. */
const DECOR_WALL = 14;

/** A world offset as an SVG translation. */
const offset = (dx: number, dy: number) => `translate(${Math.round((dy - dx) * UNIT * 100) / 100} ${Math.round(((dx + dy) * UNIT) / 2 * 100) / 100})`;

interface Piece {
  depth: number;
  key: string;
  node: ReactNode;
}

/**
 * One page of a client's level as a voxel office in cutaway: window wall, lift wall, a floor in
 * the level's theme, and a table per project whose agents sit in the pose of their recorded
 * state. The floor under a table glows when its project needs you or is at work, and under the
 * table in `focus` whatever its state. Decorative; the table plates are rendered over it by the floor.
 */
export function LevelScene({ plan, rooms, focus = null }: { plan: LevelPlan; rooms: readonly FloorRoom[]; focus?: string | null }) {
  const glows = plan.tables.flatMap((slot, index) => {
    const room = rooms[index];
    if (!room) return [];
    const signal = roomSignal(room);
    const focused = room.key === focus;
    if (signal === 'quiet' && !focused) return [];
    return [<TableGlow key={room.key} spots={tableSeats(slot, room.agents.length)} className={`vx-glow is-${signal}${focused ? ' is-focus' : ''}`} />];
  });
  const pieces: Piece[] = [];
  plan.tables.forEach((slot, index) => {
    const room = rooms[index];
    if (!room) return;
    const [ox, oy] = slot.origin;
    if (slot.kind === 'corner') pieces.push({ depth: ox + oy + 3, key: `${room.key}:corner`, node: <CornerTop at={slot.origin} /> });
    tableSeats(slot, room.agents.length).forEach((spot, seat) => {
      pieces.push({ depth: spot.at[0] + spot.at[1] + 0.6, key: `${room.key}:${seat}`, node: <Workstation spot={spot} agent={room.agents[seat]} /> });
    });
  });
  plan.plants.forEach((at, index) => pieces.push({ depth: at[0] + at[1] + 0.9, key: `plant:${index}`, node: <Plant at={at} size={1} /> }));
  if (plan.cooler && plan.theme === 'atelier') pieces.push({ depth: plan.cooler[0] + plan.cooler[1] + 0.8, key: 'cooler', node: <WaterCooler at={plan.cooler} /> });
  pieces.sort((a, b) => a.depth - b.depth);

  const { view } = plan;
  return (
    <svg
      className={`studio-scene level-scene level-${plan.layout} theme-${plan.theme}`}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <Shell plan={plan} />
      {plan.windows.map(([x0, x1]) => <Window key={x0} x0={x0} x1={x1} />)}
      <Lift span={plan.lift} />
      <g transform={offset(plan.w - DECOR_WALL, 0)}><WallDecor theme={plan.theme} /></g>
      <BackCorner theme={plan.theme} />
      {plan.theme !== 'lab' && <polygon className={`vx-rug vx-rug-${plan.theme}`} points={faceZ(0.01, ...plan.rug)} />}
      {glows}
      {pieces.map((piece) => <Fragment key={piece.key}>{piece.node}</Fragment>)}
    </svg>
  );
}

/** The floor a table's chairs and desk take, a little wider; one group, so its opacity applies once. */
function TableGlow({ spots, className }: { spots: readonly SeatSpot[]; className: string }) {
  const pad = 0.35;
  return (
    <g className={className}>
      {spots.map(({ at: [x, y], facing }, index) => (
        <polygon
          key={index}
          points={facing === 'y'
            ? faceZ(0.02, x - PITCH / 2 - pad, x + PITCH / 2 + pad, y - BACK - pad, y + REACH + pad)
            : faceZ(0.02, x - BACK - pad, x + REACH + pad, y - PITCH / 2 - pad, y + PITCH / 2 + pad)}
        />
      ))}
    </g>
  );
}

/** A solid's three visible faces; `m` names its material in studio.css, which shades them. */
function Solid({ faces, m }: { faces: BoxFaces; m: string }) {
  return (
    <g className={`vx vx-${m}`}>
      <polygon className="vx-t" points={faces.top} />
      <polygon className="vx-l" points={faces.left} />
      <polygon className="vx-r" points={faces.right} />
    </g>
  );
}

function Box({ at, size, m }: { at: Vec3; size: Vec3; m: string }) {
  return <Solid faces={boxFaces(at, size)} m={m} />;
}

/** A box given by two opposite corners in a piece's own frame. */
function Part({ f, from, to, m }: { f: Frame; from: Vec3; to: Vec3; m: string }) {
  return <Solid faces={f.box(from, to)} m={m} />;
}

function planks(W: number, D: number): string {
  const rows = Math.ceil(D);
  const seams = Array.from({ length: rows - 1 }, (_, row) => segment([0, row + 1, 0], [W, row + 1, 0]));
  const joints = Array.from({ length: rows }, (_, row) => {
    const out: string[] = [];
    for (let x = row % 2 ? 3.2 : 1.4; x < W; x += 4.6) out.push(segment([x, row, 0], [x, Math.min(row + 1, D), 0]));
    return out;
  }).flat();
  return [...seams, ...joints].join('');
}

function tiles(W: number, D: number): string {
  const out: string[] = [];
  for (let y = 2; y < D; y += 2) out.push(segment([0, y, 0], [W, y, 0]));
  for (let x = 2; x < W; x += 2) out.push(segment([x, 0, 0], [x, D, 0]));
  return out.join('');
}

function Shell({ plan }: { plan: LevelPlan }) {
  const { w: W, d: D } = plan;
  return (
    <g className="vx-shell">
      <polygon className="vx-slab-l" points={faceX(W, -WALL, D, -SLAB, 0)} />
      <polygon className="vx-slab-r" points={faceY(D, -WALL, W, -SLAB, 0)} />
      <polygon className="vx-floor" points={faceZ(0, 0, W, 0, D)} />
      <path className="vx-planks" d={plan.theme === 'lab' ? tiles(W, D) : planks(W, D)} />
      <Box at={[-WALL, -WALL, 0]} size={[WALL, D + WALL, LEVEL_HEIGHT]} m="wall-lift" />
      <Box at={[0, -WALL, 0]} size={[W, WALL, LEVEL_HEIGHT]} m="wall-window" />
      <polygon className="vx-skirting" points={faceY(0.01, 0, W, 0, 0.22)} />
      <polygon className="vx-skirting" points={faceX(0.01, 0, D, 0, 0.22)} />
    </g>
  );
}

function Window({ x0, x1 }: { x0: number; x1: number }) {
  const [z0, z1] = [2.5, 5.3];
  const blind = z0 + 1.35;
  const slats = [];
  for (let z = z1 - 0.42; z > blind; z -= 0.24) slats.push(segment([x0 + 0.2, 0.03, z], [x1 - 0.2, 0.03, z]));
  const panes = [x0 + (x1 - x0) / 3, x0 + (2 * (x1 - x0)) / 3].map((x) => segment([x, 0.04, z0 + 0.2], [x, 0.04, z1 - 0.2]));
  return (
    <g className="vx-window">
      <polygon className="vx-window-frame" points={faceY(0.01, x0, x1, z0, z1)} />
      <polygon className="vx-window-glass" points={faceY(0.02, x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2)} />
      <polygon className="vx-window-shine" points={faceY(0.025, x0 + 0.9, x0 + 1.5, z0 + 0.2, blind)} />
      <polygon className="vx-blind" points={faceY(0.03, x0 + 0.2, x1 - 0.2, blind, z1 - 0.2)} />
      <path className="vx-blind-slats" d={slats.join('')} />
      <path className="vx-window-panes" d={panes.join('')} />
      <Box at={[x0 - 0.1, 0, z0 - 0.15]} size={[x1 - x0 + 0.2, 0.3, 0.15]} m="sill" />
    </g>
  );
}

function Lift({ span: [y0, y1] }: { span: [number, number] }) {
  const top = 3.9;
  const middle = (y0 + y1) / 2;
  return (
    <g className="vx-lift">
      <polygon className="vx-lift-frame" points={faceX(0.01, y0 - 0.2, y1 + 0.2, 0, top + 0.2)} />
      <polygon className="vx-lift-door" points={faceX(0.02, y0, middle - 0.03, 0, top)} />
      <polygon className="vx-lift-door" points={faceX(0.02, middle + 0.03, y1, 0, top)} />
      <polygon className="vx-lift-panel" points={faceX(0.02, middle - 0.45, middle + 0.45, top + 0.45, top + 0.95)} />
      <polygon className="vx-lift-light" points={faceX(0.03, middle - 0.15, middle + 0.15, top + 0.55, top + 0.85)} />
      <polygon className="vx-lift-button" points={faceX(0.02, y1 + 0.45, y1 + 0.7, 1.8, 2.3)} />
    </g>
  );
}

function WallDecor({ theme }: { theme: LevelTheme }) {
  if (theme === 'lab') {
    const chart = [[11.7, 3.1], [12.2, 3.6], [12.7, 3.3], [13.3, 4.2]] as const;
    const line = chart.slice(1).map(([x, z], i) => segment([chart[i]![0], 0.03, chart[i]![1]], [x, 0.03, z])).join('');
    return (
      <g className="vx-board">
        <polygon className="vx-board-frame" points={faceY(0.01, 11.4, 13.7, 2.6, 4.8)} />
        <polygon className="vx-board-face" points={faceY(0.02, 11.5, 13.6, 2.7, 4.7)} />
        <path className="vx-board-ink" d={line} />
      </g>
    );
  }
  if (theme === 'library') {
    return (
      <g className="vx-picture">
        <polygon className="vx-picture-frame" points={faceY(0.01, 11.7, 13.4, 3.1, 4.7)} />
        <polygon className="vx-picture-sky" points={faceY(0.02, 11.85, 13.25, 3.25, 4.55)} />
        <polygon className="vx-picture-hill" points={faceY(0.03, 11.85, 13.25, 3.25, 3.75)} />
      </g>
    );
  }
  return (
    <g className="vx-clock">
      <polygon className="vx-clock-face" points={faceY(0.01, 12.1, 13.1, 3.8, 4.8)} />
      <path className="vx-clock-hands" d={segment([12.6, 0.02, 4.3], [12.6, 0.02, 4.65]) + segment([12.6, 0.02, 4.3], [12.85, 0.02, 4.3])} />
    </g>
  );
}

/** The corner between the two walls: coffee counter, bookshelf, or server racks. */
function BackCorner({ theme }: { theme: LevelTheme }) {
  if (theme === 'library') {
    const rows = [0.35, 1.45, 2.55, 3.65];
    return (
      <g>
        <Box at={[0.1, 0.2, 0]} size={[0.9, 2.4, 4.6]} m="shelf" />
        {rows.map((z, row) => <BookRow key={z} z={z} row={row} />)}
      </g>
    );
  }
  if (theme === 'lab') {
    return (
      <g>
        {[0.25, 1.45].map((y) => (
          <g key={y}>
            <Box at={[0.1, y, 0]} size={[1.1, 1.05, 4.2]} m="rack" />
            <path className="vx-rack-leds" d={[0.6, 1.2, 1.8, 2.4, 3.0, 3.6].map((z) => segment([1.21, y + 0.2, z], [1.21, y + 0.45, z])).join('')} />
          </g>
        ))}
      </g>
    );
  }
  return (
    <g>
      <Box at={[0.1, 0.2, 0]} size={[1.2, 2.4, 2.3]} m="counter" />
      <Box at={[0.1, 0.15, 2.3]} size={[1.3, 2.5, 0.15]} m="counter-top" />
      <Box at={[0.3, 0.5, 2.45]} size={[0.75, 0.75, 1]} m="dark" />
      <polygon className="vx-coffee-light" points={faceX(1.06, 0.7, 0.9, 3.05, 3.25)} />
      <Box at={[0.5, 1.6, 2.45]} size={[0.35, 0.35, 0.4]} m="mug" />
      <Plant at={[0.35, 1.95, 2.45]} size={0.55} />
    </g>
  );
}

function BookRow({ z, row }: { z: number; row: number }) {
  const widths = [0.28, 0.22, 0.32, 0.25, 0.3, 0.2, 0.27];
  let y = 0.3;
  return (
    <g>
      {widths.map((width, index) => {
        const at = y;
        y += width + 0.04;
        if (y > 2.5) return null;
        const tall = 0.62 + ((index + row) % 3) * 0.1;
        return <polygon key={index} className={`vx-book vx-book-${(index + row) % 4}`} points={faceX(1.01, at, at + width, z, z + tall)} />;
      })}
    </g>
  );
}

function WaterCooler({ at: [x, y] }: { at: Vec3 }) {
  return (
    <g>
      <Box at={[x, y, 0]} size={[0.8, 0.8, 2.4]} m="cooler" />
      <Box at={[x + 0.15, y + 0.15, 2.4]} size={[0.5, 0.5, 0.85]} m="water" />
    </g>
  );
}

function Plant({ at, size }: { at: Vec3; size: number }) {
  const [x, y, z] = at;
  const s = size;
  const pot = 0.9 * s;
  return (
    <g className="vx-plant">
      <Box at={[x, y, z]} size={[pot, pot, 0.85 * s]} m="pot" />
      <Box at={[x + 0.1 * s, y + 0.1 * s, z + 0.85 * s]} size={[0.7 * s, 0.7 * s, 0.9 * s]} m="leaf" />
      <Box at={[x - 0.2 * s, y + 0.3 * s, z + 1.3 * s]} size={[0.5 * s, 0.45 * s, 0.6 * s]} m="leaf-2" />
      <Box at={[x + 0.45 * s, y - 0.15 * s, z + 1.5 * s]} size={[0.5 * s, 0.5 * s, 0.7 * s]} m="leaf-2" />
      <Box at={[x + 0.2 * s, y + 0.2 * s, z + 1.75 * s]} size={[0.5 * s, 0.5 * s, 0.75 * s]} m="leaf" />
    </g>
  );
}

/** Where the two arms of an L-shaped table meet. */
function CornerTop({ at: [x, y] }: { at: Vec3 }) {
  return (
    <g>
      <Box at={[x + 0.8, y + 0.8, 0]} size={[0.15, 0.15, 2.2]} m="desk-frame" />
      <Box at={[x + 0.8, y + 0.8, 2.2]} size={[REACH - 0.8, REACH - 0.8, 0.25]} m="desk" />
    </g>
  );
}

/** One chair's share of a table: chair, the agent if one sits here, desk, monitor, keyboard, hands. */
function Workstation({ spot, agent }: { spot: SeatSpot; agent?: FloorAgent }) {
  const f = localFrame(spot.at, spot.facing);
  const pose = agent ? poseFor(agent.state) : null;
  const half = PITCH / 2;
  return (
    <g className={agent ? `vx-agent vx-agent-${agent.state}` : 'vx-desk-empty'} data-tone={agent ? toolTone(agent.tool) : undefined}>
      <Part f={f} from={[-0.45, -0.45, 0]} to={[0.45, 0.45, 0.14]} m="dark" />
      <Part f={f} from={[-0.08, -0.08, 0.14]} to={[0.08, 0.08, 1]} m="metal" />
      <Part f={f} from={[-0.7, -0.95, 1.35]} to={[0.7, -0.6, 3.7]} m="chair" />
      <Part f={f} from={[-0.7, -0.6, 1]} to={[0.7, 0.6, 1.35]} m="chair" />
      {pose && <Character f={f} pose={pose} />}
      <Part f={f} from={[-half, 0.8, 0]} to={[-half + 0.15, 2.2, 2.2]} m="desk-frame" />
      <Part f={f} from={[-half + 0.15, 2, 0.4]} to={[half - 0.15, 2.1, 2.2]} m="desk-frame" />
      <Part f={f} from={[half - 0.15, 0.8, 0]} to={[half, 2.2, 2.2]} m="desk-frame" />
      <Part f={f} from={[-half, 0.8, 2.2]} to={[half, 2.2, 2.45]} m="desk" />
      <Monitor f={f} screen={pose?.screen ?? 'off'} />
      <Part f={f} from={[-0.55, 1, 2.45]} to={[0.55, 1.35, 2.55]} m="keyboard" />
      {pose && <Hands f={f} pose={pose} />}
      {pose && <Marker f={f} marker={pose.marker} />}
    </g>
  );
}

function Character({ f, pose }: { f: Frame; pose: Pose }) {
  const eyes = pose.awake ? [3.68, 3.92] : [3.77, 3.83];
  const lower = pose.arms === 'rest' ? 1.7 : 2.45;
  return (
    <g className="vx-character">
      <Part f={f} from={[-0.95, -0.15, lower]} to={[-0.65, 0.15, 3]} m="tone" />
      <Part f={f} from={[-0.65, -0.5, 1.4]} to={[0.65, 0.5, 3.1]} m="tone" />
      <Part f={f} from={[-0.62, -0.6, 3.2]} to={[0.62, 0.6, 4.4]} m="head" />
      <polygon className="vx-face" points={f.front(0.61, -0.48, 0.48, 3.38, 4.2)} />
      <g className="vx-eyes">
        <polygon points={f.front(0.62, -0.32, -0.12, eyes[0]!, eyes[1]!)} />
        <polygon points={f.front(0.62, 0.12, 0.32, eyes[0]!, eyes[1]!)} />
      </g>
      <Part f={f} from={[-0.05, -0.05, 4.4]} to={[0.05, 0.05, 4.8]} m="metal" />
      <g className="vx-light"><Part f={f} from={[-0.15, -0.15, 4.8]} to={[0.15, 0.15, 5.1]} m="tone" /></g>
      {pose.arms === 'raised' ? (
        <g className="vx-raised">
          <Part f={f} from={[0.65, -0.15, 2.6]} to={[0.95, 0.15, 5.3]} m="tone" />
          <Part f={f} from={[0.6, -0.2, 5.3]} to={[1, 0.2, 5.65]} m="head" />
        </g>
      ) : (
        <Part f={f} from={[0.65, -0.15, lower]} to={[0.95, 0.15, 3]} m="tone" />
      )}
    </g>
  );
}

/** Forearms, hands, and held props: painted after the desk so they rest on it. */
function Hands({ f, pose }: { f: Frame; pose: Pose }) {
  switch (pose.arms) {
    case 'desk':
      return (
        <g>
          <Part f={f} from={[-0.95, 0.15, 2.45]} to={[-0.65, 1.3, 2.72]} m="tone" />
          <Part f={f} from={[0.65, 0.15, 2.45]} to={[0.95, 1.3, 2.72]} m="tone" />
        </g>
      );
    case 'type':
      return (
        <g>
          <Part f={f} from={[-0.95, 0.15, 2.5]} to={[-0.65, 1, 2.75]} m="tone" />
          <Part f={f} from={[0.65, 0.15, 2.5]} to={[0.95, 1, 2.75]} m="tone" />
          <g className="vx-tap"><Part f={f} from={[-0.65, 1, 2.55]} to={[-0.3, 1.3, 2.75]} m="head" /></g>
          <g className="vx-tap vx-tap-2"><Part f={f} from={[0.3, 1, 2.55]} to={[0.65, 1.3, 2.75]} m="head" /></g>
        </g>
      );
    case 'hold':
      return (
        <g>
          <Part f={f} from={[-0.95, 0.15, 2.6]} to={[-0.65, 0.8, 2.85]} m="tone" />
          <Part f={f} from={[0.65, 0.15, 2.6]} to={[0.95, 0.8, 2.85]} m="tone" />
          {pose.prop === 'book' ? (
            <g>
              <Part f={f} from={[-0.6, 0.75, 2.5]} to={[0.6, 1, 3.2]} m="book" />
              <polygon className="vx-book-pages" points={f.front(1.01, -0.5, 0.5, 2.58, 3.12)} />
              <path className="vx-book-spine" d={segment(f.at(0, 1.02, 2.58), f.at(0, 1.02, 3.12))} />
            </g>
          ) : (
            <g>
              <Part f={f} from={[-0.5, 0.8, 2.5]} to={[0.5, 0.9, 3.3]} m="paper" />
              <path className="vx-paper-lines" d={[3.15, 3, 2.85, 2.7].map((z) => segment(f.at(-0.35, 0.91, z), f.at(0.3, 0.91, z))).join('')} />
            </g>
          )}
        </g>
      );
    case 'chin':
      return (
        <g>
          <Part f={f} from={[-0.95, 0.15, 2.45]} to={[-0.65, 1.3, 2.72]} m="tone" />
          <Part f={f} from={[0.65, 0.15, 2.45]} to={[0.95, 0.5, 2.75]} m="tone" />
          <Part f={f} from={[0.35, 0.5, 2.5]} to={[0.65, 0.8, 3.25]} m="tone" />
          <Part f={f} from={[0.25, 0.6, 3.25]} to={[0.6, 0.9, 3.5]} m="head" />
        </g>
      );
    default:
      return null;
  }
}

/** A monitor at the chair's left, its screen turned toward the viewer. */
function Monitor({ f, screen }: { f: Frame; screen: Pose['screen'] }) {
  const face = -1.09;
  const [v0, v1] = [0.95, 1.95];
  const lines = (rows: readonly (readonly [number, number])[]) => rows
    .map(([z, length], index) => segment(f.at(face, v0 + 0.12 + (index % 2) * 0.1, z), f.at(face, Math.min(v1 - 0.1, v0 + 0.12 + length), z)))
    .join('');
  return (
    <g className={`vx-monitor vx-monitor-${screen}`}>
      <Part f={f} from={[-1.35, 1.2, 2.45]} to={[-0.95, 1.8, 2.52]} m="dark" />
      <Part f={f} from={[-1.22, 1.42, 2.52]} to={[-1.12, 1.58, 2.8]} m="dark" />
      <Part f={f} from={[-1.3, 0.85, 2.8]} to={[-1.1, 2.05, 3.85]} m="dark" />
      <polygon className="vx-screen" points={f.side(face, v0, v1, 2.9, 3.75)} />
      {screen === 'standby' && <polygon className="vx-screen-logo" points={f.side(face + 0.005, v0 + 0.38, v0 + 0.62, 3.22, 3.42)} />}
      {screen === 'code' && <path className="vx-screen-code" d={lines([[3.6, 0.5], [3.47, 0.7], [3.34, 0.4], [3.21, 0.75], [3.08, 0.55], [2.98, 0.3]])} />}
      {screen === 'doc' && <path className="vx-screen-text" d={lines([[3.6, 0.8], [3.46, 0.8], [3.32, 0.6], [3.18, 0.8], [3.04, 0.5]])} />}
      {screen === 'terminal' && (
        <g>
          <path className="vx-screen-term" d={lines([[3.6, 0.6], [3.46, 0.4], [3.32, 0.65]])} />
          <polygon className="vx-cursor" points={f.side(face + 0.005, v0 + 0.25, v0 + 0.37, 3.12, 3.22)} />
        </g>
      )}
      {screen === 'alert' && (
        <g>
          <polygon className="vx-alert-mark" points={f.side(face + 0.005, v0 + 0.44, v0 + 0.56, 3.3, 3.62)} />
          <polygon className="vx-alert-mark" points={f.side(face + 0.005, v0 + 0.44, v0 + 0.56, 3.08, 3.2)} />
        </g>
      )}
    </g>
  );
}

/** Status marks beside the head, drawn flat like a game's overhead icons. */
function Marker({ f, marker }: { f: Frame; marker: Pose['marker'] }) {
  if (marker === 'none') return null;
  // The head's corner furthest right on screen, whichever way the agent faces.
  const [x, y] = f.at(0, 0, 0);
  const [left, top] = project([x - 0.62, y + 0.62, 4.4]);
  const transform = `translate(${Math.round(left + 6)} ${Math.round(top - 6)})`;
  switch (marker) {
    case 'busy':
      return (
        <g className="vx-marker vx-marker-busy" transform={transform}>
          <rect className="vx-chip" x="0" y="-6" width="20" height="11" rx="5.5" />
          <circle className="vx-dot" cx="5.5" cy="-0.5" r="1.6" />
          <circle className="vx-dot vx-dot-2" cx="10" cy="-0.5" r="1.6" />
          <circle className="vx-dot vx-dot-3" cx="14.5" cy="-0.5" r="1.6" />
        </g>
      );
    case 'thought':
      return (
        <g className="vx-marker vx-marker-thought" transform={transform}>
          <circle className="vx-chip" cx="1" cy="6" r="1.8" />
          <circle className="vx-chip" cx="5" cy="1" r="2.6" />
          <rect className="vx-chip" x="5" y="-14" width="22" height="12" rx="6" />
          <circle className="vx-dot" cx="10.5" cy="-8" r="1.5" />
          <circle className="vx-dot vx-dot-2" cx="16" cy="-8" r="1.5" />
          <circle className="vx-dot vx-dot-3" cx="21.5" cy="-8" r="1.5" />
        </g>
      );
    case 'spark':
      return (
        <g className="vx-marker vx-marker-spark" transform={transform}>
          <path className="vx-spark" d="M2 0l2.5-4 2.5 4-2.5 4Z" />
          <path className="vx-spark vx-spark-2" d="M10 -8l2-3.2 2 3.2-2 3.2Z" />
          <path className="vx-spark vx-spark-3" d="M14 4l1.6-2.6 1.6 2.6-1.6 2.6Z" />
        </g>
      );
    case 'attention':
      return (
        <g className="vx-marker vx-marker-attention" transform={transform}>
          <circle cx="8" cy="-2" r="7.5" />
          <path d="M8 -6.2v4.6M8 1.6v.4" />
        </g>
      );
    case 'warning':
      return (
        <g className="vx-marker vx-marker-warning" transform={transform}>
          <path d="M8 -10l8 14H0Z" />
          <path d="M8 -5v4M8 1.6v.4" />
        </g>
      );
    case 'sleep':
      return (
        <g className="vx-marker vx-marker-sleep" transform={transform}>
          <path d="M2 -2h5l-5 6h5" />
          <path className="vx-sleep-2" d="M10 -11h4l-4 5h4" />
        </g>
      );
  }
}
