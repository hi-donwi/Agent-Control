import { useEffect, useMemo, useState } from 'react';
import { Drawer } from './Drawer';
import { CloseIcon, NewChatIcon } from '../icons';
import { AgentFigure } from '../floor/AgentFigure';
import { SectionView } from '../uidl/SectionView';
import { sectionDocument } from '../uidl/documents';
import { STATE_LABELS, type FloorAgent } from '../types';
import { ago } from '../time';
import { MessageList } from '../../components/chat/MessageList';
import { InputBar } from '../../components/chat/InputBar';
import { useProviders } from '../../hooks/useProviders';
import { useProjects } from '../../hooks/useProjects';
import { useApprovals } from '../../hooks/useApprovals';
import { useCodingSession } from '../../hooks/useCodingSession';
import { ChangesView } from './ChangesView';
import type { useScopedChat } from '../useScopedChat';
import type { ApprovalRequest, Provider } from '../../lib/types';

interface Props {
  /** '' is the workspace; otherwise the project the chat is bound to. */
  scope: string;
  /** Set when the drawer was opened from an avatar on the floor. */
  agent: FloorAgent | null;
  projectKeys: string[];
  chat: ReturnType<typeof useScopedChat>;
  dark: boolean;
  onScope: (scope: string) => void;
  onClose: () => void;
}

const SEP = '::';

/**
 * The standard AI drawer: header, scope and model, transcript, composer. Bound to a
 * project it uses that project's allowed endpoints only (ADR-0021) and shows its pending
 * approvals with explicit approve-once and deny buttons (ADR-0020).
 */
export function AssistantDrawer({ scope, agent, projectKeys, chat, dark, onScope, onClose }: Props) {
  const { providers, defaultProvider, defaultModel } = useProviders();
  const { projects } = useProjects();
  const approvals = useApprovals(scope || undefined);
  const coding = useCodingSession(scope || undefined);
  const [tab, setTab] = useState<'chat' | 'changes' | 'runs'>('chat');

  const allowed = useMemo(() => {
    const policy = projects.find((p) => p.key === scope);
    return (p: Provider) => p.locality === 'local' || Boolean(scope && policy?.allowedEndpoints?.includes(p.id));
  }, [projects, scope]);

  const options = useMemo(() => providers.flatMap((p) => p.models.map((model) => ({
    value: `${p.id}${SEP}${model}`, provider: p, model, allowed: allowed(p),
  }))), [providers, allowed]);

  const [choice, setChoice] = useState('');
  useEffect(() => {
    if (options.some((o) => o.value === choice && o.allowed)) return;
    const preferred = options.find((o) => o.allowed && o.provider.id === defaultProvider && o.model === defaultModel);
    setChoice((preferred ?? options.find((o) => o.allowed))?.value ?? '');
  }, [options, choice, defaultProvider, defaultModel]);

  useEffect(() => setTab('chat'), [scope]);

  const send = (text: string) => {
    const [provider, model] = choice.split(SEP);
    if (provider && model) chat.send(text, provider, model);
  };

  // An approved action runs only when the agent calls its tool again with the approval, so
  // the decision goes back into the conversation as a visible message, never silently.
  const decide = async (id: string, decision: 'approved' | 'denied') => {
    try {
      await approvals.decide(id, decision);
    } catch {
      return;
    }
    if (!choice || chat.isStreaming) return;
    send(decision === 'approved'
      ? `Approved request ${id}. Continue: call the tool again with approvalId ${id}.`
      : `Denied request ${id}. Do not run it; tell me another way, or stop.`);
  };

  // The Changes view reloads after every finished turn.
  const turnVersion = chat.isStreaming ? -1 : chat.messages.length;

  const suggestions = scope
    ? [`Summarize where ${scope} stands`, `List the open tasks in ${scope}`, `What changed recently in ${scope}?`]
    : ['What is every agent working on right now?', 'Which projects have open runs?', 'Summarize the rules in AGENTS.md'];

  return (
    <Drawer label="Assistant" onClose={onClose}>
      <header className="drawer-head">
        <h2 className="drawer-title">
          Assistant<span className="drawer-subtitle"> · {scope || 'Workspace'}</span>
        </h2>
        <button type="button" className="icon-btn" onClick={chat.newConversation} aria-label="New conversation">
          <NewChatIcon />
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close assistant">
          <CloseIcon />
        </button>
      </header>

      {agent && <AgentCard agent={agent} />}
      {scope && approvals.pending.length > 0 && (
        <Approvals requests={approvals.pending} deciding={approvals.decidingIds} onDecide={decide} />
      )}
      {scope && coding.known && (
        <section className="session-bar" aria-label="Coding session">
          {coding.session ? (
            <>
              <span className="session-dot" aria-hidden="true" />
              <span className="session-text">Coding on <code>{coding.session.branch}</code></span>
              <button type="button" className="btn" onClick={() => setTab('changes')}>Changes</button>
              <button type="button" className="btn" onClick={coding.stop} disabled={coding.busy}>
                {coding.busy ? 'Stopping...' : 'Stop'}
              </button>
            </>
          ) : (
            <>
              <span className="session-text">The agent edits a separate worktree, never the checkout.</span>
              <button type="button" className="btn" onClick={coding.start} disabled={coding.busy}>
                {coding.busy ? 'Starting...' : 'Start coding session'}
              </button>
            </>
          )}
          {coding.error && <p className="session-error" role="alert">[ERROR] {coding.error}</p>}
        </section>
      )}

      <div className="drawer-scope assistant-controls">
        <label>
          <span>Scope</span>
          <select value={scope} onChange={(event) => onScope(event.target.value)} aria-label="Assistant scope">
            <option value="">Workspace</option>
            {projectKeys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <label>
          <span>Model</span>
          <select value={choice} onChange={(event) => setChoice(event.target.value)} aria-label="Model">
            {options.length === 0 && <option value="">No endpoints configured</option>}
            {providers.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {p.models.map((model) => (
                  <option key={model} value={`${p.id}${SEP}${model}`} disabled={!allowed(p)}>
                    {model}{allowed(p) ? '' : ' (not allowed here)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {scope && (
        <div className="tabs" role="tablist" aria-label="Agent views">
          <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat</button>
          {coding.session && (
            <button type="button" role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>Changes</button>
          )}
          <button type="button" role="tab" aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>Runs</button>
        </div>
      )}

      {tab === 'runs' && scope ? (
        <div className="drawer-body">
          <SectionView document={sectionDocument('runs', scope)} dark={dark} />
        </div>
      ) : tab === 'changes' && scope && coding.session ? (
        <div className="drawer-body">
          <ChangesView project={scope} version={turnVersion} />
        </div>
      ) : (
        <div className="assistant-chat">
          {chat.loading && chat.messages.length === 0 ? (
            <p className="assistant-empty" role="status">Loading this conversation...</p>
          ) : chat.messages.length === 0 ? (
            <div className="assistant-empty">
              <p>{scope ? `Ask about ${scope}: its memory, runs, tasks, or code.` : 'Ask about projects, agents, runs, or memory.'}</p>
              {!choice && (
                <p className="assistant-note" role="status">
                  [INFO] No endpoint is allowed {scope ? `for ${scope}` : 'without a project'}. Add a local endpoint, or list a
                  remote one in llm.endpoints of .local/agent/policies/{scope || '<project>'}.json.
                </p>
              )}
              <div className="suggestions">
                {suggestions.map((text) => (
                  <button key={text} type="button" className="suggestion" onClick={() => send(text)} disabled={!choice || chat.isStreaming}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList messages={chat.messages} isStreaming={chat.isStreaming} />
          )}
          {chat.error && <p className="assistant-error" role="alert">[ERROR] {chat.error}</p>}
          <InputBar
            onSend={send}
            disabled={!choice || chat.loading}
            isStreaming={chat.isStreaming}
            onStop={chat.stopStreaming}
            placeholder={scope ? `Message about ${scope}...` : 'Ask about your workspace...'}
          />
        </div>
      )}
    </Drawer>
  );
}

function AgentCard({ agent }: { agent: FloorAgent }) {
  return (
    <section className="agent-card" aria-label={`Agent ${agent.tool}`}>
      <AgentFigure state={agent.state} tool={agent.tool} size={72} />
      <div className="agent-card-text">
        <p className="agent-card-name">{agent.tool}<span> · {agent.project}</span></p>
        <p className="agent-card-state">
          <span className={`state-pill state-${agent.state}`}>{STATE_LABELS[agent.state]}</span>
          <span className="agent-card-since">for {ago(agent.since)}</span>
        </p>
        {agent.detail && <p className="agent-card-detail">{agent.detail}</p>}
        {agent.source !== 'host' && (
          <p className="agent-card-note">
            Works in its own {agent.tool} session. The chat below is Agent Control on {agent.project};
            it does not reach that session.
          </p>
        )}
      </div>
    </section>
  );
}

function Approvals({ requests, deciding, onDecide }: {
  requests: ApprovalRequest[];
  deciding: string[];
  onDecide: (id: string, decision: 'approved' | 'denied') => void;
}) {
  return (
    <section className="approvals" aria-label="Waiting for you">
      {requests.map((request) => (
        <div key={request.id} className="approval">
          <div>
            <p className="approval-title">{request.action}</p>
            <p className="approval-meta">revision {request.headSha.slice(0, 8)} · expires {new Date(request.expiresAt).toLocaleTimeString()}</p>
          </div>
          <div className="approval-actions">
            <button type="button" className="btn btn-primary" disabled={deciding.includes(request.id)} onClick={() => onDecide(request.id, 'approved')}>
              Approve once
            </button>
            <button type="button" className="btn" disabled={deciding.includes(request.id)} onClick={() => onDecide(request.id, 'denied')}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
