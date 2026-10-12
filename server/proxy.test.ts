import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { forwardToControl } from './proxy.js';

interface Seen {
  method: string;
  url: string;
  host: string | undefined;
  authorization: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  body: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

describe('forwardToControl (ADR-0019 §4)', () => {
  let server: Server;
  let controlUrl: string;
  const seen: Seen[] = [];

  before(async () => {
    server = createServer(async (req, res) => {
      const body = await readBody(req);
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        host: req.headers.host,
        authorization: req.headers.authorization,
        origin: req.headers.origin,
        secFetchSite: req.headers['sec-fetch-site'] as string | undefined,
        body,
      });

      if (req.url === '/api/missing') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    controlUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('preserves the path and query and rewrites Host to the control plane', async () => {
    const response = await forwardToControl(
      new Request('http://127.0.0.1:9689/api/projects/demo/runs?limit=5'),
      { controlUrl, controlToken: 'internal-token' },
    );

    assert.equal(response.status, 200);
    const last = seen.at(-1);
    assert.equal(last?.url, '/api/projects/demo/runs?limit=5');
    assert.equal(last?.host, new URL(controlUrl).host);
  });

  it('replaces the browser credential with the internal token and strips origin hints', async () => {
    await forwardToControl(
      new Request('http://127.0.0.1:9689/api/overview', {
        headers: {
          authorization: 'Bearer browser-token',
          origin: 'http://127.0.0.1:9689',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
        },
      }),
      { controlUrl, controlToken: 'internal-token' },
    );

    const last = seen.at(-1);
    assert.equal(last?.authorization, 'Bearer internal-token');
    assert.equal(last?.origin, undefined);
    assert.equal(last?.secFetchSite, undefined);
  });

  it('forwards a POST body and method', async () => {
    await forwardToControl(
      new Request('http://127.0.0.1:9689/api/projects/demo/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
        // Node requires `half` when streaming a request body.
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
      { controlUrl, controlToken: 'internal-token' },
    );

    const last = seen.at(-1);
    assert.equal(last?.method, 'POST');
    assert.equal(last?.body, JSON.stringify({ title: 'x' }));
  });

  it('returns the control plane status and body unchanged', async () => {
    const response = await forwardToControl(
      new Request('http://127.0.0.1:9689/api/missing'),
      { controlUrl, controlToken: 'internal-token' },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'not found' });
  });
});
