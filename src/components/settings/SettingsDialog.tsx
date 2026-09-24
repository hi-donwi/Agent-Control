import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface ConfigData {
  providers: Record<string, { apiKey: string; baseUrl?: string }>;
  defaultProvider: string;
  defaultModel: string;
}

export function SettingsDialog({ open, onClose, onSaved }: Props) {
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch<ConfigData>('config').then((data) => {
      setOpenaiKey(data.providers.openai?.apiKey ?? '');
      setAnthropicKey(data.providers.anthropic?.apiKey ?? '');
      setGoogleKey(data.providers.google?.apiKey ?? '');
    });
  }, [open]);

  // Trap focus inside dialog
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const providers: Record<string, { apiKey: string }> = {};
      if (openaiKey && !openaiKey.includes('...')) providers.openai = { apiKey: openaiKey };
      if (anthropicKey && !anthropicKey.includes('...')) providers.anthropic = { apiKey: anthropicKey };
      if (googleKey && !googleKey.includes('...')) providers.google = { apiKey: googleKey };

      await apiFetch('config', {
        method: 'POST',
        body: JSON.stringify({ providers }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [openaiKey, anthropicKey, googleKey, onClose, onSaved]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="dialog" ref={dialogRef}>
        <div className="dialog-header">
          <h2 className="dialog-title">Settings</h2>
          <button className="dialog-close" onClick={onClose} aria-label="Close settings" type="button">✕</button>
        </div>
        <div className="dialog-body">
          {error && <div className="error-notice">{error}</div>}
          <div className="field">
            <label htmlFor="openai-key">OpenAI API Key</label>
            <input
              id="openai-key"
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
            <span className="hint">GPT-4o, o3, o4-mini</span>
          </div>
          <div className="field">
            <label htmlFor="anthropic-key">Anthropic API Key</label>
            <input
              id="anthropic-key"
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
            <span className="hint">Claude Sonnet 4, Opus 4, Haiku 3.5</span>
          </div>
          <div className="field">
            <label htmlFor="google-key">Google Gemini API Key</label>
            <input
              id="google-key"
              type="password"
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              placeholder="AIza..."
              autoComplete="off"
            />
            <span className="hint">Gemini 2.5 Pro, Flash</span>
          </div>
          <p className="hint" style={{ marginTop: '-8px' }}>
            Keys are stored in <code>~/.agent-control/config.json</code>, never in this project.
          </p>
        </div>
        <div className="dialog-actions">
          <button className="btn-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving} type="button">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
