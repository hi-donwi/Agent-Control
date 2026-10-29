import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage } from '../../lib/types';
import { CloseIcon } from '../icons';
import { EvidenceSummary } from './EvidenceSummary';
import {
  availableClosureActions,
  availableEvidenceActions,
  buildNoteDraft,
  buildTaskDraft,
  type CommandTarget,
  type DispatchStatus,
  type NoteDraft,
  type TaskDraft,
} from './command-state';

interface Props {
  agentId: string;
  target: CommandTarget;
  message: ChatMessage;
  status: DispatchStatus;
  dismissed: boolean;
  covered: boolean;
  onDismiss: () => void;
  onOpen: () => void;
  onContinue: () => void;
  onReview: () => void;
  onOpenTask: (scope: string, id: string) => void;
  onReviewApproval: (id: string) => void;
  onDraftTask: (draft: TaskDraft) => void;
  onDraftNote: (draft: NoteDraft) => void;
  comparisonCandidates: ChatMessage[];
  onCompare: (current: ChatMessage, candidates: ChatMessage[]) => void;
}

export function AgentResponsePopover({
  agentId,
  target,
  message,
  status,
  dismissed,
  covered,
  onDismiss,
  onOpen,
  onContinue,
  onReview,
  onOpenTask,
  onReviewApproval,
  onDraftTask,
  onDraftNote,
  comparisonCandidates,
  onCompare,
}: Props) {
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  useEffect(() => {
    setEvidenceOpen(false);
  }, [message.id]);

  useEffect(() => {
    if (dismissed) return;
    const update = () => {
      const anchor = [...document.querySelectorAll<HTMLElement>('.seat[data-agent-id]')]
        .find((element) => element.dataset.agentId === agentId);
      if (!anchor) {
        setPosition({
          right: 20,
          bottom: 'calc(92px + env(safe-area-inset-bottom))',
          maxHeight: `${Math.max(120, Math.min(420, window.innerHeight - 128))}px`,
          visibility: 'visible',
        });
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(Math.max(rect.left + rect.width / 2, 156), window.innerWidth - 156);
      const availableAbove = rect.top - 16;
      const availableBelow = window.innerHeight - rect.bottom - 16;
      const expectedHeight = evidenceOpen ? 360 : 170;
      const placeAbove = availableAbove >= expectedHeight || availableAbove >= availableBelow;
      const available = placeAbove ? availableAbove : availableBelow;
      const top = placeAbove ? rect.top - 10 : rect.bottom + 10;
      setPosition({
        left,
        top,
        transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        maxHeight: `${Math.max(120, Math.min(420, available - 16))}px`,
        visibility: 'visible',
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [agentId, dismissed, evidenceOpen]);

  if (dismissed) return null;
  const preview = message.content.trim() || 'The agent is preparing a response.';
  const actions = availableClosureActions(target, message);
  const evidenceActions = availableEvidenceActions(target, message.evidence ?? []);
  const taskDraft = status === 'complete' ? buildTaskDraft(target, message) : null;
  const noteDraft = status === 'complete' ? buildNoteDraft(target, message) : null;
  const evidence = message.evidence?.length
    ? message.evidence
    : (message.toolCalls ?? []).map((call, index) => ({
      id: call.id ?? `legacy-${index}`,
      tool: call.name,
      status: call.status,
      references: [],
    }));

  return createPortal(
    <aside
      className="command-response-popover"
      style={{ ...position, zIndex: covered ? 40 : 60, pointerEvents: covered ? 'none' : undefined }}
      aria-label={`Response from ${target.label}`}
      inert={covered}
    >
      <div className="command-response-head">
        <span className="command-response-source">{target.label} · {target.project}</span>
        <button type="button" className="command-response-close" onClick={onDismiss} aria-label="Dismiss response preview">
          <CloseIcon />
        </button>
      </div>
      <p className="command-response-state">{responseStatusLabel(status)}</p>
      <p className="command-response-preview">{preview}</p>
      <div className="command-response-actions">
        <button
          type="button"
          className="command-response-action is-primary"
          onClick={() => actions.includes('evidence') ? setEvidenceOpen((open) => !open) : onOpen()}
          aria-expanded={actions.includes('evidence') ? evidenceOpen : undefined}
        >
          {actions.includes('evidence') ? evidenceOpen ? 'Hide evidence' : 'Inspect evidence' : 'Open conversation'}
        </button>
        <button type="button" className="command-response-action" onClick={onContinue}>Continue</button>
        {actions.includes('review') && (
          <button type="button" className="command-response-action" onClick={onReview}>Review changes</button>
        )}
        {comparisonCandidates.length > 0 && (
          <button type="button" className="command-response-action" onClick={() => onCompare(message, comparisonCandidates)}>
            Compare responses
          </button>
        )}
      </div>
      {evidenceOpen && (
        <EvidenceSummary
          items={evidence}
          actions={evidenceActions}
          taskDraft={taskDraft}
          noteDraft={noteDraft}
          onOpen={onOpen}
          onOpenTask={onOpenTask}
          onReviewApproval={onReviewApproval}
          onOpenDiff={onReview}
          onDraftTask={onDraftTask}
          onDraftNote={onDraftNote}
        />
      )}
    </aside>,
    document.body,
  );
}

function responseStatusLabel(status: DispatchStatus): string {
  if (status === 'responding') return 'Responding';
  if (status === 'waiting') return 'Waiting for approval';
  if (status === 'cancelled') return 'Stopped';
  return 'Complete';
}
