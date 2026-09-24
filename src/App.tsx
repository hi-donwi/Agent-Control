import { useState, useCallback, useEffect, useMemo } from 'react';
import { useChat } from './hooks/useChat';
import { useProviders } from './hooks/useProviders';
import { MessageList } from './components/chat/MessageList';
import { InputBar } from './components/chat/InputBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import type { Provider } from './lib/types';

type ThemePref = 'light' | 'dark' | 'system';

export function App() {
  const chat = useChat();
  const { providers, defaultProvider, defaultModel, refresh: refreshProviders } = useProviders();

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

  const handleSend = useCallback((content: string) => {
    chat.sendMessage(content, selectedProvider, selectedModel);
    setSidebarOpen(false);
  }, [chat, selectedProvider, selectedModel]);

  const handleQuickAction = useCallback((prompt: string) => {
    chat.sendMessage(prompt, selectedProvider, selectedModel);
  }, [chat, selectedProvider, selectedModel]);

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
          <label htmlFor="provider-select">Provider</label>
          <select
            id="provider-select"
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {noProviders && <option value="">No providers configured</option>}
          </select>
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

        <div className="sidebar-section">
          <div className="sidebar-section-title">Conversations</div>
        </div>
        <div className="conversation-list">
          <button className="conversation-item active" type="button">
            💬 {chat.messages.length > 0
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
              >
                {t === 'light' ? '☀' : t === 'dark' ? '🌙' : '⚙'}
              </button>
            ))}
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(true)} type="button">
            ⚙ Settings
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
              ☰
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
            <div className="welcome-icon">🤖</div>
            <h2>Agent Control</h2>
            <p>Your AI-powered workspace assistant. Ask about projects, code, context, memory — or anything else.</p>

            {noProviders && (
              <div className="error-notice" style={{ marginBottom: 24, maxWidth: 480 }}>
                No API keys configured. Click <strong>Settings</strong> to add one.
              </div>
            )}

            <div className="quick-actions">
              <button className="quick-action" onClick={() => handleQuickAction('List all projects in my workspace')} type="button">
                <span className="quick-action-icon">📋</span>
                <span className="quick-action-text">
                  <span className="quick-action-label">List projects</span>
                  <span className="quick-action-desc">See all registered projects</span>
                </span>
              </button>
              <button className="quick-action" onClick={() => handleQuickAction('Show me the workspace project tree organized by client')} type="button">
                <span className="quick-action-icon">🌳</span>
                <span className="quick-action-text">
                  <span className="quick-action-label">Project tree</span>
                  <span className="quick-action-desc">Client &gt; group &gt; project</span>
                </span>
              </button>
              <button className="quick-action" onClick={() => handleQuickAction('Read the AGENTS.md file at the workspace root and summarize the key rules')} type="button">
                <span className="quick-action-icon">📖</span>
                <span className="quick-action-text">
                  <span className="quick-action-label">Workspace rules</span>
                  <span className="quick-action-desc">Summarize AGENTS.md</span>
                </span>
              </button>
              <button className="quick-action" onClick={() => handleQuickAction('What are the available agent skills in this workspace? Describe the most useful ones.')} type="button">
                <span className="quick-action-icon">🧠</span>
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
