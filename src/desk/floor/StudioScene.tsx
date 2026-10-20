import { AgentFigure } from './AgentFigure';
import { studioLayout } from './studio-layout';
import type { FloorRoom } from '../types';

/** Decorative cutaway; accessible agent controls are rendered alongside it. */
export function StudioScene({ room }: { room: FloorRoom }) {
  const layout = studioLayout(room.key);
  return (
    <svg className={`studio-scene studio-scene-${layout}`} viewBox="0 0 320 170" aria-hidden="true" focusable="false">
        <path className="studio-slab" d="M20 94 155 30 300 94 165 160Z" />
        <path className="studio-edge" d="M20 94v9l145 66v-9M165 169l135-66v-9" />
        <path className="studio-wall" d="M20 94V44l135-64v50Z" transform="translate(0 20)" />
        <path className="studio-wall-side" d="M155 50V0l145 64v50Z" />
        <path className="studio-grid" d="m65 74 145 66M110 52l145 66M68 116l135-64M116 138l135-64" />
        <path className="studio-window" d="m48 67 72-34v24L48 91Z" />
        <path className="studio-table" d="m119 97 43-20 54 24-43 20Z" />
        <path className="studio-table-leg" d="M124 100v21m84-18v20m-35-2v18" />
        <path className="studio-screen" d="m155 86 0-23 28 13v23Z" />
        <path className="studio-screen-text" d="m161 75 15 7m-15-1 9 4" />
        <path className="studio-planter" d="m258 104 13 6 12-6-3 17-10 5-9-5Z" />
        <path className="studio-leaves" d="M270 109V84m0 15q-20-3-15-19 16 2 15 19m0-5q1-18 15-18 4 16-15 18" />
        {layout === 'library' && <g className="studio-furniture"><path d="m200 45 57 26v28l-57-26Z" /><path className="studio-shelf" d="m207 51v18m9-14v18m9-14v18m9-14v18m9-14v18m-43-14 57 26" /></g>}
        {layout === 'lab' && <g className="studio-furniture"><path d="m51 105 38-18 29 13-38 18Z" /><path className="studio-screen" d="m71 99V75l23 11v24Z" /><path className="studio-screen-text" d="m76 88 13 6m-13 0 8 4" /></g>}
        {room.agents.slice(0, 3).map((agent, index) => <g key={agent.id} transform={`translate(${[104, 182, 48][index]}, ${[68, 91, 96][index]}) scale(.62)`}><AgentFigure state={agent.state} tool={agent.tool} /></g>)}
      </svg>
  );
}
