import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import type { Provider, ProvidersResponse } from '../lib/types';

export function useProviders(project?: string) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaultProvider, setDefaultProvider] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);

  const path = `providers${project ? `?project=${encodeURIComponent(project)}` : ''}`;
  const refresh = useCallback(() => {
    setLoading(true);
    return apiFetch<ProvidersResponse>(path)
      .then((data) => {
        setProviders(data.providers);
        setDefaultProvider(data.defaultProvider);
        setDefaultModel(data.defaultModel);
      })
      .catch(() => { setProviders([]); })
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { providers, defaultProvider, defaultModel, loading, refresh };
}
