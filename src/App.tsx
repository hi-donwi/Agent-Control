import { useState, useCallback, useEffect, useMemo } from 'react';
import { useChat } from './hooks/useChat';
import { useProviders } from './hooks/useProviders';
import { useProjects } from './hooks/useProjects';
import { useApprovals } from './hooks/useApprovals';
import { ApprovalInbox } from './components/approvals/ApprovalInbox';
import { useCodingSession } from './hooks/useCodingSession';
import { CodingSessionPanel } from './components/coding-session/CodingSessionPanel';
import { MessageList } from './components/chat/MessageList';
import { InputBar } from './components/chat/InputBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import type { Provider } from './lib/types';

type ThemePref = 'light' | 'dark' | 'system';

export function App() {
  const chat = useChat();
  const { providers, defaultProvider, defaultModel, refresh: refreshProviders } = useProviders();
  const { projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState(() => {
    try { return localStorage.getItem('ac-project') ?? ''; } catch { return ''; }
  });

  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem('ac-theme') as ThemePref) || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    try { localStorage.setItem('ac-theme', theme); } catch { /* noop */ }
  }, [theme]);

  useEffect(() => {
    if (defaultProvider && !selectedProvider) setSelectedProvider(defaultProvider);
    if (defaultModel && !selectedModel) setSelectedModel(defaultModel);
  }, [defaultProvider, defaultModel, selectedProvider, selectedModel]);

  const currentProvider: Provider | undefined = useMemo(
    () => providers.find((p) => p.id === selectedProvider),
    [providers, selectedProvider],
  );

  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProvider(providerId);
    const provider = providers.find((p) => p.id === providerId);
    if (provider?.models.length) setSelectedModel(provider.models[0]);
  }, [providers]);

  // A remote provider receives a project's context only when that project's policy
  // lists it (ADR-0021); without a project, only local providers can be used.
  const project = projects.find((p) => p.key === selectedProject);
  const isAllowed = useCallback((p: Provider) =>
    p.locality === 'local' || Boolean(project?.allowedEndpoints?.includes(p.id)), [project]);

  // Switching project starts a new conversation: messages of one project must not be
  // sent to an endpoint allowed only for another.
  const handleProjectChange = useCallback((key: string) => {
    setSelectedProject(key);
    try { localStorage.setItem('ac-project', key); } catch { /* noop */ }
    chat.clearMessages();
  }, [chat]);

  const { pending: pendingApprovals, decide: decideApproval, decidingIds } = useApprovals(project?.key);
  const coding = useCodingSession(project?.key);

  const handleSend = useCallback((content: string) => {
    chat.sendMessage(content, selectedProvider, selectedModel, project?.key);
    setSidebarOpen(false);
  }, [chat, selectedProvider, selectedModel, project]);

  const handleQuickAction = useCallback((prompt: string) => {
    chat.sendMessage(prompt, selectedProvider, selectedModel, project?.key);
  }, [chat, selectedProvider, selectedModel, project]);

  const noProviders = providers.length === 0;

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="dialog-backdrop"
          style={{ background: 'rgba(0,0,0,0.3)', zIndex: 40 }}
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
          type="button"
        />
      )}

      <aside className={`sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">A</div>
            <div className="brand-text">
              <span className="brand-name">Agent Control</span>
              <span className="brand-subtitle">AI Workspace Assistant</span>
            </div>
          </div>
        </div>

        <div className="model-selector">
          <label htmlFor="project-select">Project</label>
          <select
            id="project-select"
            value={project ? project.key : ''}
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            <option value="">No project (local models only)</option>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>{p.key}</option>
            ))}
          </select>
        </div>

        <div className="model-selector">
          <label htmlFor="provider-select">Provider</label>
          <select
            id="provider-select"
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!isAllowed(p)}>
                {p.name}{isAllowed(p) ? '' : ' (not allowed)'}
              </option>
            ))}
            {noProviders && <option value="">No providers configured</option>}
          </select>
          {currentProvider && !isAllowed(currentProvider) && (
            <p className="selector-note" role="status">
              {project
                ? `${currentProvider.id} is remote: list it in llm.endpoints of .local/agent/policies/${project.key}.json`
                : `${currentProvider.id} is remote: choose a project whose policy allows it`}
            </p>
          )}
        </div>

        {currentProvider && (
          <div className="model-selector">
            <label htmlFor="model-select">Model</label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {currentProvider.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <ApprovalInbox requests={pendingApprovals} onDecide={decideApproval} decidingIds={decidingIds} />

        {project && (
          <CodingSessionPanel
            session={coding.session}
            busy={coding.busy}
            error={coding.error}
            onStart={coding.start}
            onStop={coding.stop}
          />
        )}

        <div className="sidebar-section">
          <div className="sidebar-section-title">Conversations</div>
        </div>
        <div className="conversation-list">
          <button className="conversation-item active" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 6, flexShrink: 0 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {chat.messages.length > 0
              ? chat.messages[0].content.slice(0, 40) + (chat.messages[0].content.length > 40 ? '...' : '')
              : 'New conversation'}
          </button>
        </div>

        <button className="new-chat-btn" onClick={chat.clearMessages} type="button">
          + New conversation
        </button>

        <div className="sidebar-footer">
          <div className="theme-toggle" role="group" aria-label="Color theme">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
                type="button"
                title={`${t} theme`}
              >
                {t === 'light' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                ) : t === 'dark' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                )}
              </button>
            ))}
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(true)} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 6 }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="chat-header">
          <div>
            <button
              className="menu-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle navigation"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="chat-title">
              {currentProvider?.name ?? 'Agent Control'}
              {selectedModel && <span className="chat-subtitle"> · {selectedModel}</span>}
            </span>
          </div>
          <div className="chat-status">
            <span className={`status-dot${noProviders ? ' disconnected' : ''}`} />
            {noProviders ? 'No API key configured' : 'Ready'}
          </div>
        </header>

        {chat.messages.length === 0 ? (
          <div className="welcome">
            <div className="welcome-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4M8 16h.01M16 16h.01" />
              </svg>
            </div>
            <h2>Agent Control</h2>
            <p>Your AI-powered workspace assistant. Ask about projects, code, context, memory — or anything else.</p>

            {noProviders && (
              <div className="error-notice" style={{ marginBottom: 24, maxWidth: 480 }}>
                No API keys configured. Click <strong>Settings</strong> to add one.
              </div>
            )}

            <div className="quick-actions">
              <button className="quick-action" onClick={() => handleQuickAction('List all projects in my workspace')} type="button">
                <span className="quick-action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </span>
                <span className="quick-action-text">
                  <span className="quick-action-label">List projects</span>
                  <span className="quick-action-desc">See all registered projects</span>
                </span>
              </button>
              <button className="quick-action" onClick={() => handleQuickAction('Show me the workspace project tree organized by client')} type="button">
                <span className="quick-action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <span className="quick-action-text">
                  <span className="quick-action-label">Project tree</span>
                  <span className="quick-action-desc">Client &gt; group &gt; project</span>
                </span>
              </button>
              <button className="quick-action" onClick={() => handleQuickAction('Read the AGENTS.md file at the workspace root and summarize the key rules')} type="button">
                <span className="quick-action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z" />
                  </svg>
                </span>
                <span className="quick-action-text">
                  <span className="quick-action-label">Workspace rules</span>
                  <span className="quick-action-desc">Summarize AGENTS.md</span>
                </span>
              </button>
              <button className="quick-action" onClick={() => handleQuickAction('What are the available agent skills in this workspace? Describe the most useful ones.')} type="button">
                <span className="quick-action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v8M8 12h8" />
                  </svg>
                </span>
                <span className="quick-action-text">
                  <span className="quick-action-label">Agent skills</span>
                  <span className="quick-action-desc">Browse available skills</span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <MessageList messages={chat.messages} isStreaming={chat.isStreaming} />
        )}

        {chat.error && (
          <div className="error-notice">{chat.error}</div>
        )}

        <InputBar
          onSend={handleSend}
          disabled={noProviders}
          isStreaming={chat.isStreaming}
          onStop={chat.stopStreaming}
        />
      </div>

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={refreshProviders}
      />
    </div>
  );
}
