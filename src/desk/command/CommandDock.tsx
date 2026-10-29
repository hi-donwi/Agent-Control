import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../../lib/types';
import type { useScopedChat } from '../useScopedChat';
import type { Floor } from '../types';
import { AgentResponsePopover } from './AgentResponsePopover';
import type { FanoutChatState } from './FanoutChatWorker';
import {
  buildCommandTargets,
  resolveFanoutRecipients,
  priorAssistantResponses,
  transitionDispatch,
  type CommandTarget,
  type DispatchStatus,
  type FanoutCandidate,
  type NoteDraft,
  type TaskDraft,
} from './command-state';

interface Props {
  floor: Floor | null;
  scope: string;
  targetAgentId: string | null;
  chat: ReturnType<typeof useScopedChat>;
  providerReady: boolean;
  popoverBehindDrawer: boolean;
  fanoutCandidates: FanoutCandidate[];
  fanoutScopes: string[];
  fanoutChats: Record<string, FanoutChatState | undefined>;
  onTargetChange: (target: CommandTarget) => void;
  onFanoutScopesChange: (scopes: string[]) => void;
  onFanoutSend: (message: string, recipients: FanoutCandidate[]) => void;
  onStopFanout: (scopes: string[]) => void;
  onOpenTarget: (target: CommandTarget) => void;
  onOpenReview: (target: CommandTarget) => void;
  onOpenTask: (scope: string, id: string) => void;
  onReviewApproval: (target: CommandTarget, id: string) => void;
  onDraftTask: (draft: TaskDraft) => void;
  onDraftNote: (draft: NoteDraft) => void;
  onCompareResponses: (target: CommandTarget, current: ChatMessage, candidates: ChatMessage[]) => void;
  onSend: (message: string) => void;
}

interface DispatchRequest {
  id: string;
  targetId: string;
  messageCount: number;
}

interface FanoutRequest {
  id: string;
  cancelled: boolean;
  recipients: Array<{ target: CommandTarget; messageCount: number }>;
}

const PRESETS = [
  { label: 'Explore', prompt: 'What needs attention in the current scope?' },
  { label: 'Plan', prompt: 'Make a concise plan for the next useful step.' },
  { label: 'Review', prompt: 'Review the current work and identify risks or missing verification.' },
  { label: 'Summarize', prompt: 'Summarize the current scope, progress, and blockers.' },
];

export function CommandDock({ floor, scope, targetAgentId, chat, providerReady, popoverBehindDrawer, fanoutCandidates, fanoutScopes, fanoutChats, onTargetChange, onFanoutScopesChange, onFanoutSend, onStopFanout, onOpenTarget, onOpenReview, onOpenTask, onReviewApproval, onDraftTask, onDraftNote, onCompareResponses, onSend }: Props) {
  const targets = useMemo(() => buildCommandTargets(floor), [floor]);
  const target = useMemo(
    () => targets.find((item) => item.id === targetAgentId)
      ?? targets.find((item) => item.project === scope && item.writable)
      ?? targets[0],
    [scope, targetAgentId, targets],
  );
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [status, setStatus] = useState<DispatchStatus>('ready');
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  const [fanoutRequest, setFanoutRequest] = useState<FanoutRequest | null>(null);
  const [fanoutFocusTargetId, setFanoutFocusTargetId] = useState<string | null>(null);
  const [popoverDismissed, setPopoverDismissed] = useState(false);
  const [dismissedFanoutTargets, setDismissedFanoutTargets] = useState<string[]>([]);
  const [flightText, setFlightText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isOpen = !minimized && (expanded || hovered);
  const targetIsUsable = Boolean(target?.writable && target.availability === 'ready');
  const sendableTargets = fanoutCandidates.filter((candidate) => candidate.choice).map((candidate) => candidate.target);
  const selectedRecipients = resolveFanoutRecipients(sendableTargets, fanoutScopes);
  const selectedCandidates = selectedRecipients.map((recipient) => fanoutCandidates.find((candidate) => candidate.target.id === recipient.id)!);
  const fanoutMode = fanoutScopes.length > 0;
  const fanoutCanSend = selectedCandidates.length >= 2 && selectedCandidates.every(({ target: recipient }) => {
    const session = fanoutChats[recipient.project];
    return session && !session.loading && !session.isStreaming && Boolean(session.send);
  });
  const fanoutResponses = fanoutRequest?.recipients.map((recipient) => {
    const session = fanoutChats[recipient.target.project];
    const message = session ? findResponse(session.messages, recipient.messageCount) : null;
    const responseStatus = fanoutRequest.cancelled ? 'cancelled'
      : session?.error ? 'failed'
        : session?.isStreaming ? 'responding'
          : message ? 'complete'
            : 'routing';
    return { ...recipient, message, status: responseStatus as DispatchStatus, error: session?.error ?? null };
  }) ?? [];
  const fanoutComplete = fanoutResponses.length > 0
    && fanoutResponses.every((recipient) => ['complete', 'failed', 'cancelled'].includes(recipient.status));
  const fanoutBusy = Boolean(fanoutRequest && !fanoutComplete && !fanoutRequest.cancelled);
  const streaming = chat.isStreaming || fanoutBusy;
  const canType = fanoutMode || (targetIsUsable && providerReady && !chat.loading);
  const canSend = Boolean(value.trim() && (fanoutMode ? fanoutCanSend : targetIsUsable && providerReady && !chat.loading)
    && !chat.isStreaming && !fanoutBusy);
  const response = request ? findResponse(chat.messages, request.messageCount) : null;
  const comparisonCandidates = status === 'complete' && target.kind === 'project-agent' && response
    ? priorAssistantResponses(chat.messages, response.id)
    : [];
  const visibleStatus: DispatchStatus = fanoutRequest
    ? fanoutRequest.cancelled ? 'cancelled' : fanoutComplete ? 'complete' : fanoutResponses.some((recipient) => recipient.status === 'responding') ? 'responding' : 'routing'
    : status;
  const statusText = fanoutRequest
    ? fanoutRequest.cancelled ? 'Project fan-out stopped'
      : fanoutComplete
        ? `${fanoutResponses.filter((recipient) => recipient.status === 'complete').length} of ${fanoutResponses.length} project responses ready`
        : fanoutResponses.some((recipient) => recipient.status === 'responding')
          ? `Project responses ${fanoutResponses.filter((recipient) => recipient.status === 'complete').length} of ${fanoutResponses.length}`
          : `Routing to ${fanoutRequest.recipients.length} projects`
    : dispatchStatusText(status, target?.label ?? 'target');
  const contextLabel = fanoutMode
    ? `${fanoutScopes.length} project ${fanoutScopes.length === 1 ? 'recipient' : 'recipients'}`
    : target?.project ? `Project: ${target.project}` : 'Workspace context';

  useEffect(() => {
    if (!request) return;
    if (chat.error) {
      setStatus((current) => transitionDispatch(current, 'error'));
      return;
    }
    if (chat.isStreaming) {
      setStatus((current) => transitionDispatch(current, 'stream-start'));
      return;
    }
    if (chat.messages.length > request.messageCount) {
      setStatus((current) => transitionDispatch(current, 'stream-end'));
    }
  }, [chat.error, chat.isStreaming, chat.messages.length, request]);

  useEffect(() => {
    setStatus('ready');
    setRequest(null);
    setPopoverDismissed(false);
    setFlightText('');
  }, [scope, targetAgentId]);

  useEffect(() => {
    if (status !== 'routing') return;
    const timer = window.setTimeout(() => setFlightText(''), 680);
    return () => window.clearTimeout(timer);
  }, [request?.id, status]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    const message = value.trim();
    if (fanoutMode) {
      const recipients = selectedRecipients.map((recipient) => ({
        target: recipient,
        messageCount: fanoutChats[recipient.project]!.messages.length,
      }));
      setRequest(null);
      setFanoutRequest({ id: createRequestId(), cancelled: false, recipients });
      setFanoutFocusTargetId(recipients[0]?.target.id ?? null);
      setDismissedFanoutTargets([]);
      setStatus(transitionDispatch('ready', 'send'));
      setFlightText(message);
      setValue('');
      resetTextarea(inputRef.current);
      onFanoutSend(message, selectedCandidates);
      return;
    }
    setFanoutRequest(null);
    setRequest({ id: createRequestId(), targetId: target.id, messageCount: chat.messages.length });
    setPopoverDismissed(false);
    setFlightText(message);
    setStatus(transitionDispatch('ready', 'send'));
    setValue('');
    resetTextarea(inputRef.current);
    onSend(message);
  };

  const stop = () => {
    if (fanoutBusy && fanoutRequest) {
      setFanoutRequest({ ...fanoutRequest, cancelled: true });
      onStopFanout(fanoutRequest.recipients.map((recipient) => recipient.target.project));
      if (chat.isStreaming) chat.stopStreaming();
      setStatus((current) => transitionDispatch(current, 'cancel'));
      return;
    }
    chat.stopStreaming();
    setStatus((current) => transitionDispatch(current, 'cancel'));
  };

  const restore = () => {
    setMinimized(false);
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const continueFromResponse = () => {
    setValue('Continue from your last response and show the next actionable step.');
    setPopoverDismissed(true);
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const continueFromFanout = (fanoutTarget: CommandTarget) => {
    onFanoutScopesChange([]);
    setFanoutRequest(null);
    setFanoutFocusTargetId(null);
    setPopoverDismissed(true);
    onTargetChange(fanoutTarget);
    setValue('Continue from your last response and show the next actionable step.');
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const chooseTarget = (id: string) => {
    const next = targets.find((item) => item.id === id);
    if (next) {
      onFanoutScopesChange([]);
      setFanoutRequest(null);
      onTargetChange(next);
      setExpanded(true);
    }
  };

  const toggleFanoutScope = (project: string, checked: boolean) => {
    const selected = checked
      ? [...new Set([...fanoutScopes, project])]
      : fanoutScopes.filter((scope) => scope !== project);
    changeFanoutScopes(selected);
  };

  const changeFanoutScopes = (selected: string[]) => {
    onFanoutScopesChange(selected);
    setRequest(null);
    setFanoutRequest(null);
    setFanoutFocusTargetId(null);
    setPopoverDismissed(false);
    setDismissedFanoutTargets([]);
  };

  if (minimized) {
    return (
      <div className="command-dock command-dock-minimized" aria-label="Agent command dock">
        <button type="button" className="command-restore" onClick={restore} aria-label="Restore agent command dock">
          <span className="command-plane" aria-hidden="true"><PlaneIcon /></span>
          <span>{visibleStatus === 'ready' ? 'Ask the floor' : statusText}</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <section
        className={`command-dock${isOpen ? ' is-expanded' : ''}`}
        aria-label="Agent command dock"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
        }}
      >
        {status === 'routing' && flightText && (
          <span className="command-flight" aria-hidden="true">
            <span className="command-flight-copy">{flightText}</span>
            <PlaneIcon />
          </span>
        )}
        <div className="command-dock-head">
          <div className="command-dock-identity">
            <span className={`command-route-mark${visibleStatus !== 'ready' ? ' is-active' : ''}`} aria-hidden="true"><PlaneIcon /></span>
            <div>
              <p className="command-dock-title">Ask the floor</p>
              <p className="command-dock-status" role="status" aria-live="polite">{statusText}</p>
            </div>
          </div>
          <div className="command-dock-actions">
            <button type="button" className="command-icon-btn" onClick={() => setMinimized(true)} aria-label="Minimize agent command dock" title="Minimize">
              <MinimizeIcon />
            </button>
          </div>
        </div>

        <div className="command-dock-controls">
          <label className="command-control">
            <span>Target</span>
            <select value={target.id} onChange={(event) => chooseTarget(event.target.value)} aria-label="Command target" disabled={fanoutMode || fanoutBusy || chat.isStreaming}>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}{item.project ? ` · ${item.project}` : ''}{item.observedOnly ? ' (observed only)' : item.availability === 'unavailable' ? ' (unavailable)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className={`command-context command-context-${target.kind}`} title="Context enforced by the selected target">
            <span className="command-context-label">Context</span>
            <strong>{contextLabel}</strong>
          </span>
          <details className="command-fanout">
            <summary>Send to multiple projects{fanoutScopes.length ? ` (${fanoutScopes.length} selected)` : ''}</summary>
            <p>Each selected project receives the same prompt in its own scoped conversation.</p>
            <fieldset disabled={fanoutBusy || chat.isStreaming}>
              <legend>Select at least two project agents</legend>
              {fanoutCandidates.map(({ target: candidate, choice }) => {
                const unavailable = !candidate.writable || candidate.availability !== 'ready' || !choice;
                const session = fanoutChats[candidate.project];
                const reason = candidate.availability !== 'ready'
                  ? 'Target unavailable'
                  : !candidate.writable ? 'Observed-only target'
                    : !choice ? 'No allowed endpoint'
                      : !session || session.loading ? 'Loading conversation'
                        : session.isStreaming ? 'Conversation busy' : 'Ready';
                return (
                  <label key={candidate.project} className="command-fanout-option">
                    <input
                      type="checkbox"
                      aria-label={`Send to ${candidate.project}`}
                      checked={fanoutScopes.includes(candidate.project)}
                      disabled={unavailable}
                      onChange={(event) => toggleFanoutScope(candidate.project, event.target.checked)}
                    />
                    <span className="command-fanout-project">{candidate.project}</span>
                    <span className={`command-fanout-availability${unavailable ? ' is-unavailable' : ''}`}>{reason}</span>
                  </label>
                );
              })}
            </fieldset>
            {fanoutScopes.length > 0 && (
              <button
                type="button"
                className="command-response-action"
                disabled={fanoutBusy || chat.isStreaming}
                onClick={() => changeFanoutScopes([])}
              >
                Clear recipients
              </button>
            )}
            {fanoutScopes.length === 1 && <p role="status">Select at least one more project to enable fan-out.</p>}
            {fanoutScopes.length >= 2 && !fanoutCanSend && (
              <p role="status">Waiting for selected project chats to be ready.</p>
            )}
          </details>
        </div>

        {isOpen && (
          <div className="command-dock-detail">
            {fanoutMode ? (
              <div className="command-target-summary">
                <span className="command-target-state is-ready">Independent project chats</span>
                <span>{fanoutScopes.join(' · ')}</span>
              </div>
            ) : (
              <div className="command-target-summary">
                <span className={`command-target-state is-${target.availability}`}>{target.availability === 'ready' ? 'Receives commands' : target.availability === 'observed-only' ? 'Observed only' : 'Unavailable'}</span>
                <span>{target.description}</span>
                <span className="command-capabilities">{target.capabilities.join(' · ')}</span>
              </div>
            )}
            <div className="command-presets" aria-label="Command intents">
              {PRESETS.map((preset) => (
                <button key={preset.label} type="button" className="command-preset" onClick={() => { setValue(preset.prompt); setExpanded(true); requestAnimationFrame(() => inputRef.current?.focus()); }}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <form className="command-form" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="command-dock-input">
            {fanoutMode ? 'Message for selected projects' : 'Message for the selected agent'}
          </label>
          <textarea
            ref={inputRef}
            id="command-dock-input"
            rows={1}
            value={value}
            placeholder={fanoutMode ? 'Command to the selected projects...' : targetIsUsable ? 'Ask, plan, review, or summarize...' : 'Select a writable target to send a command'}
            disabled={!canType}
            onChange={(event) => { setValue(event.target.value); resizeTextarea(event.currentTarget); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            aria-describedby="command-dock-help command-dock-error"
          />
          {streaming ? (
            <button type="button" className="command-send-btn is-stop" onClick={stop} aria-label={fanoutBusy ? 'Stop all project responses' : 'Stop generating'}>
              <StopIcon />
            </button>
          ) : (
            <button type="submit" className="command-send-btn" disabled={!canSend} aria-label={fanoutMode ? 'Send to selected projects' : 'Send command'}>
              <PlaneIcon />
            </button>
          )}
        </form>
        <div className="command-dock-foot">
          <p id="command-dock-help">Enter to send · Shift + Enter for a new line</p>
          {!fanoutMode && !providerReady && <span className="command-foot-warning" role="status">No allowed endpoint</span>}
          {fanoutMode && fanoutScopes.length < 2 && <span className="command-foot-warning" role="status">Select at least two projects</span>}
          {fanoutMode && fanoutScopes.length >= 2 && !fanoutCanSend && !fanoutBusy && (
            <span className="command-foot-warning" role="status">Waiting for allowed project chats</span>
          )}
          {target && !targetIsUsable && (
            <button type="button" className="command-foot-action" onClick={() => onOpenTarget(target)} disabled={target.kind === 'observed-agent'}>
              {target.kind === 'observed-agent' ? 'Open activity only' : 'Open target'}
            </button>
          )}
          {target?.writable && request && status === 'complete' && (
            <button type="button" className="command-foot-action" onClick={() => onOpenTarget(target)}>Open conversation</button>
          )}
        </div>
        {fanoutRequest && (
          <ul className="command-fanout-results" aria-label="Project response statuses">
            {fanoutResponses.map((recipient) => (
              <li key={recipient.target.project}>
                <strong>{recipient.target.project}</strong>
                <span>{recipientStatusLabel(recipient.status)}</span>
                {recipient.status === 'complete' && (
                  <button
                    type="button"
                    className="command-fanout-open-response"
                    aria-label={`View response from ${recipient.target.project}`}
                    onClick={() => {
                      setFanoutFocusTargetId(recipient.target.id);
                      setDismissedFanoutTargets((current) => current.filter((id) => id !== recipient.target.id));
                    }}
                  >
                    View response
                  </button>
                )}
                {recipient.status === 'failed' && recipient.error && <span className="command-error" role="alert">[ERROR] {recipient.error}</span>}
              </li>
            ))}
          </ul>
        )}
        {chat.error && <p id="command-dock-error" className="command-error" role="alert">[ERROR] {chat.error}</p>}
        {response && target.agentId && status !== 'failed' && (
          <AgentResponsePopover
            agentId={target.agentId}
            target={target}
            message={response}
            status={status}
            dismissed={popoverDismissed}
            covered={popoverBehindDrawer}
            onDismiss={() => setPopoverDismissed(true)}
            onOpen={() => onOpenTarget(target)}
            onContinue={continueFromResponse}
            onReview={() => onOpenReview(target)}
            onOpenTask={onOpenTask}
            onReviewApproval={(id) => onReviewApproval(target, id)}
            onDraftTask={onDraftTask}
            onDraftNote={onDraftNote}
            comparisonCandidates={comparisonCandidates}
            onCompare={(current, candidates) => onCompareResponses(target, current, candidates)}
          />
        )}
        {fanoutResponses.map((recipient) => recipient.target.id === fanoutFocusTargetId && recipient.message && recipient.target.agentId
          && recipient.status === 'complete' ? (
          <AgentResponsePopover
            key={`${fanoutRequest?.id}:${recipient.target.id}`}
            agentId={recipient.target.agentId}
            target={recipient.target}
            message={recipient.message}
            status={recipient.status}
            dismissed={dismissedFanoutTargets.includes(recipient.target.id)}
            covered={popoverBehindDrawer}
            continueDisabled={fanoutBusy}
            onDismiss={() => setDismissedFanoutTargets((current) => current.includes(recipient.target.id)
              ? current
              : [...current, recipient.target.id])}
            onOpen={() => onOpenTarget(recipient.target)}
            onContinue={() => continueFromFanout(recipient.target)}
            onReview={() => onOpenReview(recipient.target)}
            onOpenTask={onOpenTask}
            onReviewApproval={(id) => onReviewApproval(recipient.target, id)}
            onDraftTask={onDraftTask}
            onDraftNote={onDraftNote}
            comparisonCandidates={recipient.status === 'complete'
              ? priorAssistantResponses(fanoutChats[recipient.target.project]?.messages ?? [], recipient.message.id)
              : []}
            onCompare={(current, candidates) => onCompareResponses(recipient.target, current, candidates)}
          />
        ) : null)}
      </section>
    </>
  );
}

function findResponse(messages: ChatMessage[], fromIndex: number): ChatMessage | null {
  return messages.slice(fromIndex).find((message) => message.role === 'assistant') ?? null;
}

function dispatchStatusText(status: DispatchStatus, target: string): string {
  switch (status) {
    case 'routing': return `Routing to ${target}`;
    case 'responding': return `${target} is responding`;
    case 'waiting': return `${target} is waiting for approval`;
    case 'complete': return 'Response ready';
    case 'failed': return 'Dispatch failed';
    case 'cancelled': return 'Generation stopped';
    default: return 'Ready for a command';
  }
}

function recipientStatusLabel(status: DispatchStatus): string {
  switch (status) {
    case 'routing': return 'Routing';
    case 'responding': return 'Responding';
    case 'waiting': return 'Waiting for approval';
    case 'complete': return 'Response ready';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Stopped';
    default: return 'Ready';
  }
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `command-${Date.now()}`;
}

function resizeTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
}

function resetTextarea(element: HTMLTextAreaElement | null): void {
  if (element) element.style.height = 'auto';
}

function PlaneIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 11 18-8-8 18-2.5-7.5L3 11Z" /><path d="m10.5 13.5 4-4" /></svg>;
}

function StopIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}

function MinimizeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>;
}
