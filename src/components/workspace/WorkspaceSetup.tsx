import { useState } from 'react';
import { chooseDesktopWorkspace } from '../../lib/api';

export function WorkspaceSetup() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Choose the Agent-Workspace folder to start Agent Control.');
  const [error, setError] = useState('');

  async function chooseWorkspace() {
    setPending(true);
    setError('');
    setStatus('Opening the folder picker.');
    try {
      const selected = await chooseDesktopWorkspace();
      if (selected) {
        setStatus('Workspace selected. Restarting the desktop host.');
        window.location.reload();
        return;
      }
      setStatus('No workspace was selected. Agent Control has not started.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not select that workspace. Try again.');
      setStatus('Workspace selection needs attention.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="workspace-setup">
      <section className="workspace-setup__card" aria-labelledby="workspace-setup-title">
        <p className="workspace-setup__eyebrow">Agent Control Desktop</p>
        <h1 id="workspace-setup-title">Choose a workspace</h1>
        <p>
          Select the Agent-Workspace folder that contains <code>AGENTS.md</code> and{' '}
          <code>.agents/standards</code>. Agent Control uses this folder as its active workspace.
        </p>
        <button
          type="button"
          className="workspace-setup__button"
          onClick={() => void chooseWorkspace()}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? 'Selecting workspace…' : 'Choose workspace'}
        </button>
        <p className="workspace-setup__status" role="status" aria-live="polite">{status}</p>
        {error && <p className="workspace-setup__error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
