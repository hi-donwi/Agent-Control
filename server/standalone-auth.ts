import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { isLoopbackRemoteAddress } from './middleware/security.js';

const DEVELOPMENT_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

/** Serve the in-memory process token to a local browser over an explicit GET exchange. */
export function standaloneAuthOnly(token: string) {
  return (c: Context) => {
    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Origin');
    if (c.req.method !== 'GET') return c.json({ error: 'GET is required.' }, 405);

    const remoteAddress = getConnInfo(c).remote.address ?? '';
    if (!isLoopbackRemoteAddress(remoteAddress)) {
      return c.json({ error: 'Loopback authentication is required.' }, 403);
    }

    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin && !DEVELOPMENT_ORIGINS.has(origin)) {
      return c.json({ error: 'Request origin is not allowed.' }, 403);
    }

    return c.json({ token });
  };
}
