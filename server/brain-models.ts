import type { Endpoint } from './endpoints.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const MAX_MODEL_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODEL_COUNT = 1000;
const MAX_MODEL_ID_LENGTH = 256;

async function readModelList(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Agent Brain returned an invalid model list');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MODEL_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Agent Brain returned an invalid model list');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Agent Brain returned an invalid model list');
  }
}

/** Reads redacted model IDs from an explicitly configured Agent Brain gateway. */
export async function discoverBrainModels(
  endpoint: Endpoint,
  credential: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  if (endpoint.protocol !== 'openai-chat' || endpoint.purpose !== 'agent-brain' || !endpoint.baseUrl) {
    throw new Error('Agent Brain model discovery is not enabled for this endpoint');
  }

  const url = new URL(endpoint.baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
  url.search = '';
  url.hash = '';
  const headers = new Headers({ Accept: 'application/json' });
  if (credential) headers.set('Authorization', `Bearer ${credential}`);

  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error('Agent Brain model discovery request failed');
  }
  if (!response.ok) throw new Error(`Agent Brain model discovery failed with HTTP ${response.status}`);

  let body: unknown;
  try {
    body = await readModelList(response);
  } catch {
    throw new Error('Agent Brain returned an invalid model list');
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error('Agent Brain returned an invalid model list');
  }

  const ids = new Set<string>();
  for (const row of (body as { data: unknown[] }).data) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim() && id.length <= MAX_MODEL_ID_LENGTH) ids.add(id);
    if (ids.size >= MAX_MODEL_COUNT) break;
  }
  return [...ids];
}
