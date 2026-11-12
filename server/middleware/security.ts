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
export function tokenAuth(token: string, options: { allowQueryToken?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    const queryToken = options.allowQueryToken === false ? undefined : c.req.query('token');
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

    if (matches(queryToken) || matches(bearerToken)) {
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

/**
 * Context key for a per-response script nonce (`index.ts` sets it when it injects the token
 * into HTML). Without it, `script-src 'self'` would block the injection and the page would
 * only work when its URL carries `?token=`.
 */
const SCRIPT_NONCE = 'scriptNonce';

type NonceContext = Context<{ Variables: Record<string, string> }>;

/** Record the nonce the inline script in this response carries. */
export function setScriptNonce(c: Context, nonce: string): void {
  (c as NonceContext).set(SCRIPT_NONCE, nonce);
}

/** The nonce recorded for this response, if the handler set one. */
function scriptNonceOf(c: Context): string | undefined {
  return (c as NonceContext).get(SCRIPT_NONCE);
}

/** Build the Content-Security-Policy, optionally allowing one nonce'd inline script. */
export function contentSecurityPolicy(scriptNonce?: string, brainFrameOrigins: readonly string[] = []): string {
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
    scriptNonce ? `script-src 'self' 'nonce-${scriptNonce}'` : "script-src 'self'",
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
    c.header('Content-Security-Policy', contentSecurityPolicy(scriptNonceOf(c), brainFrameOrigins));
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
