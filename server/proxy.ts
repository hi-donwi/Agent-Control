/**
 * Reverse proxy to the Python control plane (Agent-Workspace ADR-0019 §4).
 *
 * In agent mode the agent host is the single browser-facing origin. Its own API lives
 * under `/api/agent/*`; every other `/api/*` request belongs to the control plane and is
 * forwarded here. The browser never holds the control-plane token: this function strips
 * the browser's credentials and origin hints and presents the internal token instead.
 */

export interface ControlProxyOptions {
  /** Base URL of the control plane, e.g. `http://127.0.0.1:54321`. */
  controlUrl: string;
  /** Internal bearer token the control plane expects. */
  controlToken: string;
}

/** Per RFC 9110, a proxy must not forward connection-specific headers. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Headers the browser sends for its own origin; they are meaningless to the control plane. */
function isBrowserOriginHeader(name: string): boolean {
  return (
    name === 'origin' ||
    name === 'referer' ||
    name === 'authorization' ||
    name === 'cookie' ||
    name.startsWith('sec-fetch-')
  );
}

/**
 * Forward a browser request to the control plane and return its response unchanged.
 *
 * The control plane enforces a `Host` guard and an `Origin` guard, so `Host` is rewritten
 * to the control plane and `Origin`/`Sec-Fetch-*` are dropped rather than passed through.
 */
export async function forwardToControl(
  request: Request,
  opts: ControlProxyOptions,
): Promise<Response> {
  const incoming = new URL(request.url);
  const base = new URL(opts.controlUrl);
  const target = new URL(incoming.pathname + incoming.search, base);

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (key === 'host') continue;
    if (isBrowserOriginHeader(key)) continue;
    headers.set(key, value);
  }
  headers.set('host', base.host);
  headers.set('authorization', `Bearer ${opts.controlToken}`);

  const method = request.method.toUpperCase();
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request.body;
    // Node's fetch requires `half` when streaming a request body.
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);

  const outHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    // The body is streamed as-is; let the server recompute framing and encoding.
    if (key === 'content-length' || key === 'content-encoding') continue;
    outHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
