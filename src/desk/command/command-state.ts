import type { Floor, FloorAgent } from '../types';
import type { ChatMessage, EvidenceMetadata, ProjectInfo, Provider } from '../../lib/types';

export type TargetKind = 'control-plane' | 'project-agent' | 'observed-agent';
export type TargetAvailability = 'ready' | 'observed-only' | 'unavailable';

export interface CommandTarget {
  id: string;
  label: string;
  description: string;
  kind: TargetKind;
  project: string;
  agentId: string | null;
  state: FloorAgent['state'] | 'ready';
  writable: boolean;
  observedOnly: boolean;
  availability: TargetAvailability;
  capabilities: string[];
}

export type ClosureAction = 'continue' | 'evidence' | 'review';
export type EvidenceAction =
  | { kind: 'open-task'; id: string; scope: string; evidenceId: string }
  | { kind: 'review-approval'; id: string; evidenceId: string }
  | { kind: 'open-diff'; evidenceId: string };

export interface TaskDraft {
  scope: string;
  title: string;
}

export interface NoteDraft extends TaskDraft {
  body: string;
}

export interface ChatChoice {
  provider: string;
  model: string;
}

export type DispatchStatus = 'ready' | 'routing' | 'responding' | 'waiting' | 'complete' | 'failed' | 'cancelled';
export type DispatchEvent = 'send' | 'stream-start' | 'stream-end' | 'animation-end' | 'approval' | 'error' | 'cancel' | 'retry';

const LOCAL_CAPABILITIES = ['chat', 'workspace context'];
const PROJECT_CAPABILITIES = ['chat', 'project context'];

export function buildCommandTargets(floor: Floor | null): CommandTarget[] {
  const agents = floor?.zones.flatMap((zone) => zone.rooms.flatMap((room) => room.agents)) ?? [];
  return [
    {
      id: 'control-plane',
      label: 'Control Plane',
      description: 'Workspace routing and coordination',
      kind: 'control-plane',
      project: '',
      agentId: null,
      state: 'ready',
      writable: true,
      observedOnly: false,
      availability: 'ready',
      capabilities: LOCAL_CAPABILITIES,
    },
    ...agents.map((agent): CommandTarget => {
      const observedOnly = agent.source !== 'host';
      const unavailable = agent.state === 'offline';
      const hasCodingSession = Boolean(floor?.zones
        .flatMap((zone) => zone.rooms)
        .find((room) => room.key === agent.project)?.codingSession);
      const capabilities = observedOnly ? ['presence', 'activity'] : [
        ...PROJECT_CAPABILITIES,
        ...(hasCodingSession ? ['review'] : []),
      ];
      return {
        id: agent.id,
        label: agent.tool,
        description: observedOnly
          ? `Observed session in ${agent.project}; cannot receive desk commands`
          : `Project agent for ${agent.project}`,
        kind: observedOnly ? 'observed-agent' : 'project-agent',
        project: agent.project,
        agentId: agent.id,
        state: agent.state,
        writable: !observedOnly && !unavailable,
        observedOnly,
        availability: observedOnly ? 'observed-only' : unavailable ? 'unavailable' : 'ready',
        capabilities,
      };
    }),
  ];
}

export function availableClosureActions(target: CommandTarget, message: ChatMessage): ClosureAction[] {
  const actions: ClosureAction[] = ['continue'];
  if (message.evidence?.some((item) => item.status === 'done') || message.toolCalls?.some((call) => call.status === 'done')) {
    actions.push('evidence');
  }
  if (target.capabilities.includes('review')) actions.push('review');
  return actions;
}

const TASK_EVIDENCE_TOOLS = new Set(['list_tasks', 'today', 'add_task', 'update_task']);
const APPROVAL_EVIDENCE_TOOLS = new Set(['add_task', 'update_task']);
const TASK_ID_RE = /^task_[a-z0-9][a-z0-9_-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Navigates only to records in this writable project and never decides or mutates them. */
export function availableEvidenceActions(target: CommandTarget, evidence: EvidenceMetadata[]): EvidenceAction[] {
  if (target.kind !== 'project-agent' || !target.writable || target.availability !== 'ready' || !target.project) return [];

  const actions: EvidenceAction[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    if (item.status !== 'done') continue;
    for (const reference of item.references) {
      if (reference.kind === 'task' && TASK_EVIDENCE_TOOLS.has(item.tool)
        && TASK_ID_RE.test(reference.id) && (!reference.scope || reference.scope === target.project)) {
        const key = `task:${reference.id}:${target.project}`;
        if (!seen.has(key)) {
          seen.add(key);
          actions.push({ kind: 'open-task', id: reference.id, scope: target.project, evidenceId: item.id });
        }
      }
      if (reference.kind === 'approval' && APPROVAL_EVIDENCE_TOOLS.has(item.tool) && UUID_RE.test(reference.id)) {
        const key = `approval:${reference.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          actions.push({ kind: 'review-approval', id: reference.id, evidenceId: item.id });
        }
      }
      if (reference.kind === 'diff' && item.tool === 'git_diff'
        && reference.id === item.id && target.capabilities.includes('review')) {
        const key = `diff:${reference.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          actions.push({ kind: 'open-diff', evidenceId: item.id });
        }
      }
    }
  }
  return actions;
}

/** Build a suggested title only; the existing task form still requires an explicit submit. */
export function buildTaskDraft(target: CommandTarget, message: ChatMessage): TaskDraft | null {
  if (target.kind !== 'project-agent' || !target.writable || target.availability !== 'ready' || !target.project
    || message.role !== 'assistant') return null;

  const firstLine = message.content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}(?:\s|$)/.test(line))
    .map((line) => line.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/[`*_~]/g, '').trim())
    .find(Boolean);
  if (!firstLine) return null;

  const sentenceEnd = firstLine.search(/[.!?](?:\s|$)/);
  const sentence = sentenceEnd < 0 ? firstLine : firstLine.slice(0, sentenceEnd);
  const title = sentence.replace(/\s+/g, ' ').trim().slice(0, 120).trim();
  return title ? { scope: target.project, title } : null;
}

/** Preserve the full Markdown response as an editable note body; the existing form saves it. */
export function buildNoteDraft(target: CommandTarget, message: ChatMessage): NoteDraft | null {
  const taskDraft = buildTaskDraft(target, message);
  const body = message.content.trim();
  return taskDraft && body ? { ...taskDraft, body } : null;
}

/** Candidate responses are earlier, non-empty assistant messages from this scoped chat only. */
export function priorAssistantResponses(messages: ChatMessage[], currentId: string): ChatMessage[] {
  const currentIndex = messages.findIndex((message) => message.id === currentId);
  if (currentIndex < 0 || messages[currentIndex]?.role !== 'assistant') return [];
  return messages.slice(0, currentIndex)
    .filter((message) => message.role === 'assistant' && Boolean(message.content.trim()))
    .reverse();
}

export function resolveChatChoice(
  providers: Provider[],
  projects: ProjectInfo[],
  scope: string,
  defaultProvider: string,
  defaultModel: string,
): ChatChoice | null {
  const project = projects.find((item) => item.key === scope);
  const allowed = (provider: Provider) => provider.locality === 'local'
    || Boolean(scope && project?.allowedEndpoints?.includes(provider.id));
  const preferred = providers.find((provider) => provider.id === defaultProvider && allowed(provider));
  const provider = preferred ?? providers.find(allowed);
  if (!provider) return null;
  const model = preferred && provider.id === defaultProvider && provider.models.includes(defaultModel)
    ? defaultModel
    : provider.models[0];
  return model ? { provider: provider.id, model } : null;
}

export function transitionDispatch(status: DispatchStatus, event: DispatchEvent): DispatchStatus {
  if (event === 'error') return 'failed';
  if (event === 'cancel') return 'cancelled';
  if (event === 'approval' && (status === 'routing' || status === 'responding')) return 'waiting';
  if (event === 'retry' && (status === 'failed' || status === 'cancelled')) return 'routing';
  if (status === 'ready' && event === 'send') return 'routing';
  if ((status === 'routing' || status === 'waiting') && event === 'stream-start') return 'responding';
  if (status === 'responding' && event === 'stream-end') return 'complete';
  return status;
}
