import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../../lib/types';
import type { useScopedChat } from '../useScopedChat';
import type { Floor } from '../types';
import { AgentResponsePopover } from './AgentResponsePopover';
import {
  buildCommandTargets,
  priorAssistantResponses,
  transitionDispatch,
  type CommandTarget,
  type DispatchStatus,
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
  onTargetChange: (target: CommandTarget) => void;
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

const PRESETS = [
  { label: 'Explore', prompt: 'What needs attention in the current scope?' },
  { label: 'Plan', prompt: 'Make a concise plan for the next useful step.' },
  { label: 'Review', prompt: 'Review the current work and identify risks or missing verification.' },
  { label: 'Summarize', prompt: 'Summarize the current scope, progress, and blockers.' },
];

export function CommandDock({ floor, scope, targetAgentId, chat, providerReady, popoverBehindDrawer, onTargetChange, onOpenTarget, onOpenReview, onOpenTask, onReviewApproval, onDraftTask, onDraftNote, onCompareResponses, onSend }: Props) {
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
  const [popoverDismissed, setPopoverDismissed] = useState(false);
  const [flightText, setFlightText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isOpen = !minimized && (expanded || hovered);
  const targetIsUsable = Boolean(target?.writable && target.availability === 'ready');
  const canSend = Boolean(value.trim() && targetIsUsable && providerReady && !chat.loading && !chat.isStreaming);
  const response = request ? findResponse(chat.messages, request.messageCount) : null;
  const comparisonCandidates = status === 'complete' && target.kind === 'project-agent' && response
    ? priorAssistantResponses(chat.messages, response.id)
    : [];
  const statusText = dispatchStatusText(status, target?.label ?? 'target');
  const contextLabel = target?.project ? `Project: ${target.project}` : 'Workspace context';

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
    setRequest({ id: createRequestId(), targetId: target.id, messageCount: chat.messages.length });
    setPopoverDismissed(false);
    setFlightText(message);
    setStatus(transitionDispatch('ready', 'send'));
    setValue('');
    resetTextarea(inputRef.current);
    onSend(message);
  };

  const stop = () => {
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

  const chooseTarget = (id: string) => {
    const next = targets.find((item) => item.id === id);
    if (next) {
      onTargetChange(next);
      setExpanded(true);
    }
  };

  if (minimized) {
    return (
      <div className="command-dock command-dock-minimized" aria-label="Agent command dock">
        <button type="button" className="command-restore" onClick={restore} aria-label="Restore agent command dock">
          <span className="command-plane" aria-hidden="true"><PlaneIcon /></span>
          <span>{status === 'ready' ? 'Ask the floor' : statusText}</span>
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
            <span className={`command-route-mark${status !== 'ready' ? ' is-active' : ''}`} aria-hidden="true"><PlaneIcon /></span>
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
            <select value={target.id} onChange={(event) => chooseTarget(event.target.value)} aria-label="Command target">
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
        </div>

        {isOpen && (
          <div className="command-dock-detail">
            <div className="command-target-summary">
              <span className={`command-target-state is-${target.availability}`}>{target.availability === 'ready' ? 'Receives commands' : target.availability === 'observed-only' ? 'Observed only' : 'Unavailable'}</span>
              <span>{target.description}</span>
              <span className="command-capabilities">{target.capabilities.join(' · ')}</span>
            </div>
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
          <label className="visually-hidden" htmlFor="command-dock-input">Message for the selected agent</label>
          <textarea
            ref={inputRef}
            id="command-dock-input"
            rows={1}
            value={value}
            placeholder={targetIsUsable ? 'Ask, plan, review, or summarize...' : 'Select a writable target to send a command'}
            disabled={!targetIsUsable || !providerReady || chat.loading}
            onChange={(event) => { setValue(event.target.value); resizeTextarea(event.currentTarget); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            aria-describedby="command-dock-help command-dock-error"
          />
          {chat.isStreaming ? (
            <button type="button" className="command-send-btn is-stop" onClick={stop} aria-label="Stop generating">
              <StopIcon />
            </button>
          ) : (
            <button type="submit" className="command-send-btn" disabled={!canSend} aria-label="Send command">
              <PlaneIcon />
            </button>
          )}
        </form>
        <div className="command-dock-foot">
          <p id="command-dock-help">Enter to send · Shift + Enter for a new line</p>
          {!providerReady && <span className="command-foot-warning" role="status">No allowed endpoint</span>}
          {target && !targetIsUsable && (
            <button type="button" className="command-foot-action" onClick={() => onOpenTarget(target)} disabled={target.kind === 'observed-agent'}>
              {target.kind === 'observed-agent' ? 'Open activity only' : 'Open target'}
            </button>
          )}
          {target?.writable && request && status === 'complete' && (
            <button type="button" className="command-foot-action" onClick={() => onOpenTarget(target)}>Open conversation</button>
          )}
        </div>
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
