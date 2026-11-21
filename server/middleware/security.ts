import type { Context, Next } from 'hono';
import crypto from 'node:crypto';

/** Generate a cryptographically secure process token. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** The host contract pins the server listener to IPv4 loopback. */
export function isLoopbackBindHost(host: string): boolean {
  return host === '127.0.0.1';
}

/** Recognize IPv4 and IPv6 loopback peer addresses, including IPv4-mapped IPv6. */
export function isLoopbackRemoteAddress(address: string): boolean {
  const normalized = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address;
  if (normalized === '::1') return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  const octets = normalized.split('.').map(Number);
  return octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255);
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
    const authHeader = c.req.header('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    const matches = (candidate: string | undefined): boolean => {
      if (!candidate || candidate.length !== token.length) return false;
      const candidateBytes = Buffer.from(candidate);
      const tokenBytes = Buffer.from(token);
      if (candidateBytes.length !== tokenBytes.length) return false;
      return crypto.timingSafeEqual(candidateBytes, tokenBytes);
    };

    if (matches(bearerToken)) {
      await next();
    } else {
      return c.json({ error: 'Invalid or missing token.' }, 401);
    }
  };
}

const DESKTOP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const DESKTOP_HEADERS = new Set(['authorization', 'content-type']);

/** Require an exact trusted desktop-webview origin and answer a narrow CORS preflight. */
export function desktopOriginOnly(allowedOrigins: readonly string[]) {
  const origins = new Set(allowedOrigins);
  if (origins.size === 0 || origins.has('*')) {
    throw new Error('Desktop origins must be explicit and non-empty.');
  }

  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin');
    if (!origin || !origins.has(origin)) {
      return c.json({ error: 'Desktop origin is not allowed.' }, 403);
    }

    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');

    if (c.req.method === 'OPTIONS') {
      const requestedMethod = c.req.header('access-control-request-method')?.toUpperCase();
      const requestedHeaders = (c.req.header('access-control-request-headers') ?? '')
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      if (!requestedMethod || !DESKTOP_METHODS.includes(requestedMethod as typeof DESKTOP_METHODS[number])
        || requestedHeaders.some((header) => !DESKTOP_HEADERS.has(header))) {
        return c.json({ error: 'Desktop preflight is not allowed.' }, 403);
      }
      c.header('Access-Control-Allow-Methods', DESKTOP_METHODS.join(', '));
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      c.header('Access-Control-Max-Age', '300');
      return c.body(null, 204);
    }

    await next();
  };
}

/** Check Origin on the entire API namespace, including `/api` and unmatched routes. */
export function apiOriginOnly(options: {
  allowedOrigins?: readonly string[];
  desktopOrigins?: readonly string[];
} = {}) {
  const desktopGuard = options.desktopOrigins ? desktopOriginOnly(options.desktopOrigins) : undefined;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  return async (c: Context, next: Next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      await next();
      return;
    }
    if (desktopGuard) return desktopGuard(c, next);

    const origin = c.req.header('origin');
    const requestOrigin = new URL(c.req.url).origin;
    // Fetch omits Origin on same-origin GET/HEAD requests. Require the browser's
    // protected Fetch Metadata signal for those reads; all other API requests
    // still need an explicit, allowed Origin.
    const sameOriginBrowserRead = !origin
      && ['GET', 'HEAD'].includes(c.req.method)
      && c.req.header('sec-fetch-site') === 'same-origin';
    if (!sameOriginBrowserRead && (!origin || (origin !== requestOrigin && !allowedOrigins.has(origin)))) {
      return c.json({ error: 'Request origin is not allowed.' }, 403);
    }
    await next();
  };
}

/** Build the Content-Security-Policy without inline scripts. */
export function contentSecurityPolicy(brainFrameOrigins: readonly string[] = []): string {
  const origins = [...new Set(brainFrameOrigins.filter((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin === origin && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
    } catch {
      return false;
    }
  }))];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src 'self'${origins.length ? ` ${origins.join(' ')}` : ''}`,
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
}

/** Middleware: set security headers on every response. */
export function securityHeaders(brainFrameOrigins: readonly string[] = []) {
  return async (c: Context, next: Next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Content-Security-Policy', contentSecurityPolicy(brainFrameOrigins));
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
