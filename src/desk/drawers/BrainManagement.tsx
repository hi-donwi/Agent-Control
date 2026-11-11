import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { BrainManagementTarget } from './brain-management-api';

export function BrainManagement() {
  const [targets, setTargets] = useState<BrainManagementTarget[]>([]);
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    void apiFetch<{ targets: BrainManagementTarget[] }>('brain-management-targets')
      .then(({ targets: available }) => {
        if (!current) return;
        setTargets(available);
        setTargetId(available[0]?.id ?? '');
      })
      .catch(() => {
        if (current) setError('Configured Agent Brain targets could not be loaded.');
      });
    return () => { current = false; };
  }, []);

  const target = targets.find((item) => item.id === targetId);

  return (
    <section className="brain-management" aria-labelledby="brain-management-title">
      <header className="brain-management__heading">
        <div>
          <h3 id="brain-management-title" className="settings-label">Agent Brain management</h3>
          <p className="settings-hint">This is a Brain-origin interface. Account credentials stay inside Agent Brain and never enter Agent Control.</p>
        </div>
      </header>
      {targets.length > 1 && (
        <label className="brain-management__target">
          Brain endpoint
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {targets.map((item) => <option key={`${item.id}:${item.managementUrl}`} value={item.id}>{item.id} · {item.managementUrl}</option>)}
          </select>
        </label>
      )}
      {error && <p className="brain-management__error" role="alert">{error}</p>}
      {target ? (
        <iframe
          key={`${target.id}:${target.managementUrl}`}
          className="brain-management__frame"
          title={`Agent Brain management for ${target.id}`}
          src={`${target.managementUrl}/manage-ui/`}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
        />
      ) : targets.length === 0 && !error ? (
        <p className="settings-hint">No secure Agent Brain management endpoint is configured.</p>
      ) : null}
    </section>
  );
}
