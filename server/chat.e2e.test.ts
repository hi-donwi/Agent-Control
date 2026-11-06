import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end chat against the real entry point (server/index.ts), not a unit seam.
 *
 * The workspace is disposable and its `mock` endpoint answers offline, so this exercises
 * the whole path - loopback gate, token, endpoint load, egress policy, the AI SDK stream,
 * and our line protocol - without a network call. It is the pattern to extend when a
 * browser harness lands (it would drive the same server).
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      probe.close(() => resolve(address.port));
    });
  });
}

/** Lines of the line protocol with empty ones dropped, as the UI reads them. */
async function protocolLines(response: Response): Promise<string[]> {
  return (await response.text()).split('\n').filter(Boolean);
}

const answerText = (lines: string[]) => lines.filter((l) => l.startsWith('0:')).map((l) => JSON.parse(l.slice(2)) as string).join('');

describe('chat end to end with the mock provider (ADR-0019 follow-up)', { timeout: 30_000 }, () => {
  let root: string;
  let home: string;
  let child: ChildProcess;
  let origin: string;
  let token: string;
  let brainServer: HttpServer;
  let brainPort: number;
  let brainCalls = 0;
  let brainAuthorization = '';
  let brainChatCalls = 0;
  const brainChatBodies: Array<Record<string, unknown>> = [];
  // Model `hang` streams one chunk and then holds the request open until the caller closes it.
  let hangClosed!: () => void;
  const brainHangClosed = new Promise<void>((resolve) => { hangClosed = resolve; });
  // Model `silent` accepts the request and never sends a chunk.
  let silentClosed!: () => void;
  const brainSilentClosed = new Promise<void>((resolve) => { silentClosed = resolve; });
  // A provider reached directly, not through Brain: no chat, and no Brain failure, may land here.
  let directServer: HttpServer;
  let directCalls = 0;
  let serverLog = '';

  const post = (body: unknown) =>
    fetch(`${origin}/api/agent/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'ac-e2e-'));
    home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    brainServer = createHttpServer((request, response) => {
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        void (async () => {
          const requestChunks: Buffer[] = [];
          for await (const chunk of request) requestChunks.push(Buffer.from(chunk));
          const requestBody = JSON.parse(Buffer.concat(requestChunks).toString('utf8')) as Record<string, unknown>;
          if (requestBody.model === 'hang') {
            response.on('close', () => hangClosed());
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write('data: {"id":"chatcmpl-hang","object":"chat.completion.chunk","created":1,"model":"hang","choices":[{"index":0,"delta":{"role":"assistant","content":"partial answer"},"finish_reason":null}]}\n\n');
            return;
          }
          if (requestBody.model === 'silent') {
            response.on('close', () => silentClosed());
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.flushHeaders();
            return;
          }
          if (requestBody.model === 'refuse') {
            // What an upstream refusal can carry: an account name, a key fragment, an internal address.
            response.writeHead(401, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'account acct-brain-9 rejected key sk-upstream-secret at 10.1.2.3', type: 'auth' } }));
            return;
          }
          brainChatCalls += 1;
          brainChatBodies.push(requestBody);
          brainAuthorization = request.headers.authorization ?? '';
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const chunks = brainChatCalls === 1
            ? [
              'data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"chat","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-list-projects","type":"function","function":{"name":"list_projects","arguments":"{}"}}]},"finish_reason":null}]}',
              '',
              'data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"chat","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
            ]
            : [
              'data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"chat","choices":[{"index":0,"delta":{"role":"assistant","content":"brain-backed reply after host tool"},"finish_reason":null}]}',
              '',
              'data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
            ];
          response.end([...chunks, '', 'data: [DONE]', '', ''].join('\n'));
        })().catch(() => response.writeHead(500).end());
        return;
      }
      if (request.method !== 'GET' || request.url !== '/v1/models') {
        response.writeHead(404).end();
        return;
      }
      brainCalls += 1;
      brainAuthorization = request.headers.authorization ?? '';
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'chat' }, { id: 'anthropic/claude-sonnet' }] }));
    });
    await new Promise<void>((resolve, reject) => {
      brainServer.once('error', reject);
      brainServer.listen(0, '127.0.0.1', () => {
        const address = brainServer.address() as AddressInfo;
        brainPort = address.port;
        resolve();
      });
    });
    directServer = createHttpServer((request, response) => {
      directCalls += 1;
      request.resume();
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end([
          'data: {"id":"chatcmpl-direct","object":"chat.completion.chunk","created":1,"model":"direct","choices":[{"index":0,"delta":{"role":"assistant","content":"direct reply"},"finish_reason":null}]}',
          '',
          'data: {"id":"chatcmpl-direct","object":"chat.completion.chunk","created":1,"model":"direct","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
          '', 'data: [DONE]', '', '',
        ].join('\n'));
      });
    });
    const directPort = await new Promise<number>((resolve, reject) => {
      directServer.once('error', reject);
      directServer.listen(0, '127.0.0.1', () => resolve((directServer.address() as AddressInfo).port));
    });
    // Nothing listens here: a Brain that is down.
    const brainDownPort = await freePort();
    mkdirSync(join(root, '.agents', 'standards'), { recursive: true });
    mkdirSync(join(root, '.agents', 'bin'), { recursive: true });
    mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
    mkdirSync(join(root, 'context'), { recursive: true });
    mkdirSync(join(root, 'projects', 'mock', 'mockproj'), { recursive: true });
    mkdirSync(join(home, '.brain'), { recursive: true });
    writeFileSync(join(home, '.brain', 'serve.token'), 'gateway-token\n', { mode: 0o600 });
    // Keys from before chat went through Agent Brain: the server must ignore them, never list
    // them as providers, and never print them.
    mkdirSync(join(home, '.agent-control'), { recursive: true });
    writeFileSync(join(home, '.agent-control', 'config.json'), JSON.stringify({
      providers: { openai: { apiKey: 'sk-legacy-openai-key' }, anthropic: { apiKey: 'sk-ant-legacy-key' } },
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
    }));
    writeFileSync(join(root, 'AGENTS.md'), '# mock workspace\n');
    writeFileSync(join(root, 'context', 'registry.tsv'), 'key\tclient\tgroup\tfolder\nmockproj\tframework\t-\tprojects/mock/mockproj\n');
    writeFileSync(join(root, '.local', 'agent', 'endpoints.json'), JSON.stringify({
      endpoints: {
        mock: { protocol: 'mock', models: ['echo'] },
        remote: { protocol: 'openai-chat', baseUrl: 'https://example.invalid/v1', models: ['x'] },
        brain: {
          protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${brainPort}/v1`,
          apiKey: 'file:~/.brain/serve.token', locality: 'remote', purpose: 'agent-brain', models: ['fallback-model'],
        },
        // The same gateway with a short model-silence limit, so a timeout test runs in under a second.
        'brain-slow': {
          protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${brainPort}/v1`,
          apiKey: 'file:~/.brain/serve.token', locality: 'remote', purpose: 'agent-brain', models: [],
          timeouts: { firstChunkMs: 300, chunkMs: 300 },
        },
        'brain-down': {
          protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${brainDownPort}/v1`,
          apiKey: 'file:~/.brain/serve.token', locality: 'remote', purpose: 'agent-brain', models: [],
        },
        direct: { protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${directPort}/v1`, models: ['direct'] },
      },
    }));
    // The bridge shells out to `<root>/.agents/bin/ws`; stub the CLI boundary so the
    // project-bound path runs without a real workspace or the network.
    const ws = join(root, '.agents', 'bin', 'ws');
    writeFileSync(ws, '#!/bin/sh\nprintf "mockproj\\tframework\\t-\\tprojects/mock/mockproj\\t-\\t-\\t-\\n"\n');
    chmodSync(ws, 0o755);

    const port = await freePort();
    child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home, WS_WORKSPACE_ROOT: root, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Kept so a test can prove what the server never logs (prompts, upstream error bodies).
    child.stderr?.on('data', (chunk: Buffer) => { serverLog += chunk.toString('utf8'); });

    token = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error(`server did not print a token:\n${buffer}`)), 20_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const match = buffer.match(/Open: http:\/\/\S+\?token=([a-f0-9]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (code ${code}):\n${buffer}`)); });
    });
    origin = `http://127.0.0.1:${port}`;
  });

  after(() => {
    child?.kill('SIGKILL');
    brainServer?.close();
    directServer?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('streams the mock answer over the line protocol, with no network call', async () => {
    const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'mock', model: 'echo' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
    const lines = await protocolLines(response);
    assert.equal(answerText(lines), 'mock(echo): hello');
    assert.equal(JSON.parse(lines.at(-1)!.slice(2)).finishReason, 'stop');
  });

  it('streams the same answer for a chat bound to a project', async () => {
    const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'mock', model: 'echo', project: 'mockproj' });
    assert.equal(response.status, 200);
    assert.equal(answerText(await protocolLines(response)), 'mock(echo): hello');
    const floor = await fetch(`${origin}/api/agent/desk/floor`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await floor.json() as { zones: Array<{ rooms: Array<{ key: string; agents: unknown[] }> }> };
    const room = body.zones.flatMap((zone) => zone.rooms).find((row) => row.key === 'mockproj');
    assert.deepEqual(room?.agents, []);
  });

  it('keeps a conversation\'s turns, readable as the scope\'s latest, and refuses it for another project', async () => {
    const conversation = '44444444-4444-4444-8444-444444444444';
    const first = await post({ messages: [{ role: 'user', content: 'remember me' }], provider: 'mock', model: 'echo', project: 'mockproj', conversation });
    assert.equal(answerText(await protocolLines(first)), 'mock(echo): remember me');

    const latest = await fetch(`${origin}/api/agent/conversations/latest?scope=mockproj`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await latest.json() as { id: string; messages: Array<{ role: string; content: string }> };
    assert.equal(body.id, conversation);
    assert.deepEqual(body.messages.map((m) => [m.role, m.content]), [['user', 'remember me'], ['assistant', 'mock(echo): remember me']]);

    // The same conversation, sent unbound, would mix a project's history into another scope.
    const unbound = await post({ messages: [{ role: 'user', content: 'leak' }], provider: 'mock', model: 'echo', conversation });
    assert.equal(unbound.status, 400);
  });

  it('refuses an endpoint that is not Agent Brain, and a legacy provider, before any request', async () => {
    for (const provider of ['remote', 'direct']) {
      const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider, model: 'x', project: 'mockproj' });
      assert.equal(response.status, 400);
      assert.match((await response.json() as { error: string }).error, /not an Agent Brain endpoint/);
    }
    const legacy = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'openai', model: 'gpt-4o' });
    assert.equal(legacy.status, 400);
    assert.match((await legacy.json() as { error: string }).error, /"openai" is not configured/);
    assert.equal(directCalls, 0);
  });

  it('refuses Agent Brain for a chat without a project policy that lists it', async () => {
    const before = brainChatCalls;
    const response = await post({ messages: [{ role: 'user', content: 'hello' }], provider: 'brain', model: 'chat' });
    assert.equal(response.status, 403);
    assert.match((await response.json() as { error: string }).error, /remote/);
    assert.equal(brainChatCalls, before);
  });

  it('lists only Agent Brain and mock endpoints, and ignores legacy provider keys', async () => {
    const response = await fetch(`${origin}/api/agent/providers`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json() as { providers: Array<{ id: string }>; defaultProvider: string; defaultModel: string };
    assert.deepEqual(body.providers.map((p) => p.id), ['mock', 'brain', 'brain-slow', 'brain-down']);
    // The legacy default names a provider that cannot chat, so the first Brain endpoint wins.
    assert.equal(body.defaultProvider, 'brain');
    assert.equal(body.defaultModel, 'fallback-model');
    assert.doesNotMatch(JSON.stringify(body), /sk-legacy|sk-ant-legacy/);

    const config = await fetch(`${origin}/api/agent/config`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(config.status, 404);
    assert.match(serverLog, /config\.json holds API keys for openai, anthropic/);
    assert.doesNotMatch(serverLog, /sk-legacy-openai-key|sk-ant-legacy-key/);
  });

  it('discovers Brain models only for a registered project whose policy allows the gateway', async () => {
    const getProviders = (query = '') => fetch(`${origin}/api/agent/providers${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const unscoped = await getProviders();
    assert.equal(unscoped.status, 200);
    assert.equal(brainCalls, 0);

    const denied = await getProviders('?project=mockproj');
    assert.equal(denied.status, 200);
    assert.equal(brainCalls, 0);

    writeFileSync(join(root, '.local', 'agent', 'policies', 'mockproj.json'), JSON.stringify({
      schema_version: 1, default: 'read', llm: { endpoints: ['brain'] },
    }));
    const allowed = await getProviders('?project=mockproj');
    assert.equal(allowed.status, 200);
    const body = await allowed.json() as { providers: Array<{ id: string; models: string[] }> };
    const brain = body.providers.find((provider) => provider.id === 'brain');
    assert.deepEqual(brain?.models, ['fallback-model', 'chat', 'anthropic/claude-sonnet']);
    assert.equal(brainCalls, 1);
    assert.equal(brainAuthorization, 'Bearer gateway-token');
    assert.doesNotMatch(JSON.stringify(body), /gateway-token/);

    const unknown = await getProviders('?project=not-registered');
    assert.equal(unknown.status, 400);
    assert.equal(brainCalls, 1);
  });

  it('streams inference through Brain while keeping workspace tools on the Agent-Control host', async () => {
    writeFileSync(join(root, '.local', 'agent', 'policies', 'mockproj.json'), JSON.stringify({
      schema_version: 1, default: 'read', llm: { endpoints: ['brain'] },
    }));
    const response = await post({
      messages: [{ role: 'user', content: 'hello' }], provider: 'brain', model: 'chat', project: 'mockproj',
    });

    assert.equal(response.status, 200);
    assert.equal(answerText(await protocolLines(response)), 'brain-backed reply after host tool');
    assert.equal(brainChatCalls, 2);
    assert.equal(brainAuthorization, 'Bearer gateway-token');
    assert.equal(brainChatBodies[0].model, 'chat');
    assert.ok(Array.isArray(brainChatBodies[0].tools) && brainChatBodies[0].tools.length > 0);
    const followUpMessages = brainChatBodies[1].messages as Array<{ role: string }>;
    assert.ok(followUpMessages.some((message) => message.role === 'tool'));
    const floor = await fetch(`${origin}/api/agent/desk/floor`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await floor.json() as { zones: Array<{ rooms: Array<{ key: string; agents: Array<{ tool: string }> }> }> };
    const room = body.zones.flatMap((zone) => zone.rooms).find((row) => row.key === 'mockproj');
    assert.deepEqual(room?.agents.map((agent) => agent.tool), ['agent-control']);
  });

  it('cancels the Brain request when the browser stops the turn, and keeps the partial answer', async () => {
    writeFileSync(join(root, '.local', 'agent', 'policies', 'mockproj.json'), JSON.stringify({
      schema_version: 1, default: 'read', llm: { endpoints: ['brain'] },
    }));
    const conversation = '55555555-5555-4555-8555-555555555555';
    const browser = new AbortController();
    const response = await fetch(`${origin}/api/agent/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'stop me' }], provider: 'brain', model: 'hang', project: 'mockproj', conversation }),
      signal: browser.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = '';
    while (!seen.includes('0:"partial answer"')) {
      const { value, done } = await reader.read();
      assert.equal(done, false, `stream ended before the partial answer: ${seen}`);
      seen += decoder.decode(value);
    }

    browser.abort();
    const timedOut = Symbol('timeout');
    const closed = await Promise.race([brainHangClosed, delay(5_000).then(() => timedOut)]);
    assert.notEqual(closed, timedOut, 'the Brain request stayed open after the browser stopped the turn');

    const settled = await eventually(async () => {
      const latest = await fetch(`${origin}/api/agent/conversations/latest?scope=mockproj`, { headers: { Authorization: `Bearer ${token}` } });
      const history = await latest.json() as { id: string; messages: Array<{ role: string; content: string }> };
      const floor = await fetch(`${origin}/api/agent/desk/floor`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await floor.json() as { zones: Array<{ rooms: Array<{ key: string; agents: Array<{ state: string; detail: string }> }> }> };
      const agent = body.zones.flatMap((zone) => zone.rooms).find((row) => row.key === 'mockproj')?.agents[0];
      const done = history.id === conversation && history.messages.at(-1)?.role === 'assistant' && agent?.state === 'idle';
      return done ? { history, agent } : undefined;
    });
    assert.deepEqual(settled.history.messages.map((m) => [m.role, m.content]), [['user', 'stop me'], ['assistant', 'partial answer']]);
    assert.equal(settled.agent?.detail, 'turn stopped');
  });

  it('shows a refused Brain call as a sanitized error, and logs neither the upstream body nor the prompt', async () => {
    writeFileSync(join(root, '.local', 'agent', 'policies', 'mockproj.json'), JSON.stringify({
      schema_version: 1, default: 'read', llm: { endpoints: ['brain'] },
    }));
    const response = await post({ messages: [{ role: 'user', content: 'PROMPT-MARKER-71' }], provider: 'brain', model: 'refuse', project: 'mockproj' });
    assert.equal(response.status, 200);
    const lines = await protocolLines(response);
    const errors = lines.filter((l) => l.startsWith('e:')).map((l) => JSON.parse(l.slice(2)) as string);
    assert.deepEqual(errors, ['The model endpoint refused the credentials (HTTP 401). Check the endpoint\'s credential.']);
    assert.doesNotMatch(lines.join('\n'), /acct-brain-9|sk-upstream-secret|10\.1\.2\.3|127\.0\.0\.1/);

    await eventually(async () => (/Inference error: unauthorized/.test(serverLog) ? true : undefined));
    assert.match(serverLog, /Inference error: unauthorized \(HTTP 401, AI_APICallError\)/);
    assert.doesNotMatch(serverLog, /PROMPT-MARKER-71|acct-brain-9|sk-upstream-secret|gateway-token/);
  });

  it('shows a Brain that is down as unreachable, and never falls back to a direct endpoint', async () => {
    // The direct endpoint answers and the policy lists it, so a fallback would have somewhere to go.
    writeFileSync(join(root, '.local', 'agent', 'policies', 'mockproj.json'), JSON.stringify({
      schema_version: 1, default: 'read', llm: { endpoints: ['brain-down', 'direct'] },
    }));
    const directBefore = directCalls;

    const response = await post({ messages: [{ role: 'user', content: 'are you there?' }], provider: 'brain-down', model: 'chat', project: 'mockproj' });
    assert.equal(response.status, 200);
    const lines = await protocolLines(response);
    assert.deepEqual(lines.filter((l) => l.startsWith('e:')).map((l) => JSON.parse(l.slice(2)) as string), ['The model endpoint is unreachable. Check that it is running.']);
    assert.equal(answerText(lines), '');
    assert.equal(directCalls, directBefore, 'a direct endpoint was called while Brain was down');
    await eventually(async () => (/Inference error: unreachable/.test(serverLog) ? true : undefined));
  });

  it('ends a turn whose model stays silent with a timeout error, and closes the Brain request', async () => {
    writeFileSync(join(root, '.local', 'agent', 'policies', 'mockproj.json'), JSON.stringify({
      schema_version: 1, default: 'read', llm: { endpoints: ['brain', 'brain-slow'] },
    }));
    const response = await post({ messages: [{ role: 'user', content: 'anyone there?' }], provider: 'brain-slow', model: 'silent', project: 'mockproj' });
    assert.equal(response.status, 200);
    const lines = await protocolLines(response);
    assert.deepEqual(lines.filter((l) => l.startsWith('e:')).map((l) => JSON.parse(l.slice(2)) as string), ['The model request timed out.']);
    assert.ok(!lines.some((l) => l.startsWith('d:')), lines.join('\n'));

    const timedOut = Symbol('timeout');
    const closed = await Promise.race([brainSilentClosed, delay(5_000).then(() => timedOut)]);
    assert.notEqual(closed, timedOut, 'the Brain request stayed open after the timeout');
    await eventually(async () => (/Inference error: timeout/.test(serverLog) ? true : undefined));
    assert.doesNotMatch(serverLog, /anyone there\?/);

    // A model that went silent is a warning on the floor, not a turn the operator stopped.
    const agent = await eventually(async () => {
      const floor = await fetch(`${origin}/api/agent/desk/floor`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await floor.json() as { zones: Array<{ rooms: Array<{ key: string; agents: Array<{ state: string; detail: string }> }> }> };
      const found = body.zones.flatMap((zone) => zone.rooms).find((row) => row.key === 'mockproj')?.agents[0];
      return found?.state === 'warning' ? found : undefined;
    });
    assert.equal(agent.detail, 'the model timed out');
  });
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it returns a value; the server finishes a stopped turn asynchronously. */
async function eventually<T>(check: () => Promise<T | undefined>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await delay(50);
  }
}
