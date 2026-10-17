import { AgentFigure } from '../floor/AgentFigure';
import { HandGlyph } from '../room/glyphs';
import { dueTone } from './board';
import type { PmTask } from './types';

interface Props {
  task: PmTask;
  today: string;
  /** Show the project or client chip: off when the lane already says it. */
  showScope: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const DUE_TEXT = { late: 'late', today: 'today', soon: '' } as const;

/** A ticket: priority stripe, where it belongs, when it is due, who has it, how far it is. */
export function MissionCard({ task, today, showScope, dragging, onOpen, onDragStart, onDragEnd }: Props) {
  const tone = dueTone(task, today);
  const done = task.checklist.filter((c) => c.done).length;
  const agent = task.assignee.startsWith('agent:') ? task.assignee.slice('agent:'.length) : '';
  return (
    <li
      className={`mission priority-${task.priority}${task.blocked ? ' is-blocked' : ''}${dragging ? ' is-dragging' : ''}${task.kind === 'milestone' ? ' is-milestone' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="mission-open" onClick={onOpen}
        aria-label={`${task.kind === 'milestone' ? 'Milestone' : 'Task'}: ${task.title}${task.blocked ? `, blocked: ${task.blocked_reason}` : ''}`}>
        <span className="mission-title">{task.title}</span>
        <span className="mission-meta">
          {showScope && <span className="chip">{task.scope}</span>}
          {task.due && <span className={`mission-due is-${tone || 'later'}`}>{DUE_TEXT[tone as keyof typeof DUE_TEXT] || task.due}</span>}
          {task.checklist.length > 0 && <span className="mission-progress">{done}/{task.checklist.length}</span>}
          {task.progress && <span className="mission-progress">{task.progress.done}/{task.progress.total} done</span>}
          {agent
            ? <span className="mission-agent" title={task.assignee}><AgentFigure state="typing" tool={agent} size={20} /></span>
            : task.assignee && <span className="mission-who" title={task.assignee}>{task.assignee.slice(0, 2).toUpperCase()}</span>}
        </span>
        {task.blocked && <span className="mission-blocked"><HandGlyph /><span>{task.blocked_reason}</span></span>}
      </button>
    </li>
  );
}
