import type { Context, Next } from 'hono';
import crypto from 'node:crypto';

/** Generate a cryptographically secure process token. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Middleware: reject non-loopback connections. */
export function loopbackOnly() {
  return async (c: Context, next: Next) => {
    const host = c.req.header('host') ?? '';
    const hostname = host.split(':')[0];
    const allowed = ['127.0.0.1', 'localhost', '::1'];
    if (!allowed.some(h => hostname === h)) {
      return c.json({ error: 'Loopback connections only.' }, 403);
    }
    await next();
  };
}

/** Middleware: verify bearer token. */
export function tokenAuth(token: string) {
  return async (c: Context, next: Next) => {
    // Allow token as query param for initial page load
    const queryToken = c.req.query('token');
    const authHeader = c.req.header('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    if (queryToken === token || bearerToken === token) {
      await next();
    } else {
      return c.json({ error: 'Invalid or missing token.' }, 401);
    }
  };
}

/** Middleware: set security headers on every response. */
export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "img-src 'self' data:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '));
  };
}

const requestCounts = new Map<string, { count: number; reset: number }>();

/** Middleware: simple in-memory rate limiter. */
export function rateLimit(maxRequests = 60, windowMs = 60_000) {
  return async (c: Context, next: Next) => {
    const key = 'loopback'; // Single-user, just prevent runaway loops
    const now = Date.now();
    const entry = requestCounts.get(key);

    if (!entry || now > entry.reset) {
      requestCounts.set(key, { count: 1, reset: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > maxRequests) {
        return c.json({ error: 'Rate limit exceeded. Try again shortly.' }, 429);
      }
    }
    await next();
  };
}
