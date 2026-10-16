import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getAuthToken } from '../lib/api';
import { parseSse } from './sse';
import type { Floor } from './types';

/** Waits before reconnecting a dropped stream: quick at first, then backing off. */
const RETRY_MS = [1000, 3000, 10000];

/**
 * The floor, live. It streams `GET /api/agent/desk/events` - a new floor whenever
 * something on it changes - read with fetch so the token stays in a header. When the
 * stream drops it fetches the floor once, so the screen is never stale for long, and
 * reconnects with a backoff. `live` says whether the stream is up.
 */
export function useFloor() {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const attempt = useRef(0);

  const refresh = useCallback(() => {
    apiFetch<Floor>('desk/floor')
      .then((next) => { setFloor(next); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        const response = await fetch('/api/agent/desk/events', {
          headers: { Authorization: `Bearer ${getAuthToken()}`, Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`stream refused (${response.status})`);
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const parsed = parseSse(buffer + value);
          buffer = parsed.rest;
          for (const message of parsed.messages) {
            if (message.event !== 'floor') continue;
            setFloor(JSON.parse(message.data) as Floor);
            setError(null);
            setLive(true);
            attempt.current = 0;
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
      if (controller.signal.aborted) return;
      setLive(false);
      refresh();
      const wait = RETRY_MS[Math.min(attempt.current, RETRY_MS.length - 1)];
      attempt.current += 1;
      timer = setTimeout(connect, wait);
    };

    void connect();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  return { floor, error, live, refresh };
}
