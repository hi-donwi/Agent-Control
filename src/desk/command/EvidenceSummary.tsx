import type { EvidenceAction, NoteDraft, TaskDraft } from './command-state';

interface EvidenceItem {
  id: string;
  tool: string;
  status: string;
  references: Array<{ kind: string; id: string; scope?: string }>;
}

interface Props {
  items: EvidenceItem[];
  actions: EvidenceAction[];
  taskDraft: TaskDraft | null;
  noteDraft: NoteDraft | null;
  onOpen: () => void;
  onOpenTask: (scope: string, id: string) => void;
  onReviewApproval: (id: string) => void;
  onOpenDiff: () => void;
  onDraftTask: (draft: TaskDraft) => void;
  onDraftNote: (draft: NoteDraft) => void;
}

export function EvidenceSummary({
  items,
  actions,
  taskDraft,
  noteDraft,
  onOpen,
  onOpenTask,
  onReviewApproval,
  onOpenDiff,
  onDraftTask,
  onDraftNote,
}: Props) {
  return (
    <section className="command-evidence" aria-label="Response evidence">
      <div className="command-evidence-head">
        <strong>Evidence</strong>
        <span>Read-only summary</span>
      </div>
      <ul className="command-evidence-list">
        {items.map((item) => (
          <li key={item.id} className="command-evidence-item">
            <span className={`command-evidence-status is-${item.status}`}>{evidenceStatusLabel(item.status)}</span>
            <span className="command-evidence-tool">{item.tool.replace(/_/g, ' ')}</span>
            {item.references.length > 0 && (
              <span className="command-evidence-refs">
                {item.references.map((reference) => reference.kind === 'diff'
                  ? 'diff available'
                  : `${reference.kind} ${reference.id}${reference.scope ? ` · ${reference.scope}` : ''}`).join(' · ')}
              </span>
            )}
            {actions.filter((action) => action.evidenceId === item.id).map((action) => {
              if (action.kind === 'open-task') {
                return (
                  <button
                    key={`${action.kind}:${action.id}`}
                    type="button"
                    className="command-evidence-action"
                    onClick={() => onOpenTask(action.scope, action.id)}
                  >
                    Open task {action.id}
                  </button>
                );
              }
              if (action.kind === 'review-approval') {
                return (
                  <button
                    key={`${action.kind}:${action.id}`}
                    type="button"
                    className="command-evidence-action"
                    onClick={() => onReviewApproval(action.id)}
                  >
                    Review approval {action.id.slice(0, 8)}
                  </button>
                );
              }
              return (
                <button
                  key={`${action.kind}:${action.evidenceId}`}
                  type="button"
                  className="command-evidence-action"
                  onClick={onOpenDiff}
                >
                  Open diff
                </button>
              );
            })}
          </li>
        ))}
      </ul>
      <p className="command-evidence-note">Full tool output stays in the scoped conversation.</p>
      {taskDraft && (
        <button type="button" className="command-response-action" onClick={() => onDraftTask(taskDraft)}>
          Draft task from response
        </button>
      )}
      {noteDraft && (
        <button type="button" className="command-response-action" onClick={() => onDraftNote(noteDraft)}>
          Draft note from response
        </button>
      )}
      <button type="button" className="command-response-action" onClick={onOpen}>Open conversation</button>
    </section>
  );
}

function evidenceStatusLabel(status: string): string {
  if (status === 'done') return 'Complete';
  if (status === 'error') return 'Failed';
  return 'Running';
}
