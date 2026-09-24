import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import type { Provider, ProvidersResponse } from '../lib/types';

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaultProvider, setDefaultProvider] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ProvidersResponse>('providers')
      .then((data) => {
        setProviders(data.providers);
        setDefaultProvider(data.defaultProvider);
        setDefaultModel(data.defaultModel);
      })
      .catch(() => { /* No providers available */ })
      .finally(() => setLoading(false));
  }, []);

  const refresh = () => {
    setLoading(true);
    apiFetch<ProvidersResponse>('providers')
      .then((data) => {
        setProviders(data.providers);
        setDefaultProvider(data.defaultProvider);
        setDefaultModel(data.defaultModel);
      })
      .finally(() => setLoading(false));
  };

  return { providers, defaultProvider, defaultModel, loading, refresh };
}
