import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { stepCountIs, streamText, type ModelMessage } from 'ai';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import crypto from 'node:crypto';

import { loadConfig, saveConfig, availableProviders, type AppConfig } from './config.js';
import { createOpenAIAdapter } from './providers/openai.js';
import { createAnthropicAdapter } from './providers/anthropic.js';
import { createGeminiAdapter } from './providers/gemini.js';
import type { ProviderAdapter } from './providers/types.js';
import { loadEndpoints, localityOf, type Endpoint } from './endpoints.js';
import { decide, listPending } from './approvals.js';
import { readCodingSession, startCodingSession, stopCodingSession } from './coding-sessions.js';
import { realSessionRunner } from './ws-runner.js';
import { resolveChatModel } from './chat-model.js';
import { WorkspaceBridge, findWorkspaceRoot } from './tools/workspace.js';
import { createChatTools, type ChatScope } from './tools/chat-tools.js';
import { gitDiff } from './tools/worktree-files.js';
import { parseProjectList } from './projects.js';
import { loadLlmAllowlist } from './egress.js';
import { toLineStream, type StreamFinish } from './stream-protocol.js';
import { recordUsage } from './usage.js';
import {
  generateToken,
  loopbackOnly,
  tokenAuth,
  securityHeaders,
  rateLimit,
  setScriptNonce,
} from './middleware/security.js';
import { forwardToControl } from './proxy.js';
import { WORKSPACE_SCOPE, appendMessage, captureAssistant, isConversationId, isScope, latestConversation } from './conversations.js';
import { ActivityRegistry, deskFloor, floorEvents, isCollection, queryRows, readCollection } from './desk/index.js';
import { addNote, realWsInputRunner } from './desk/notes.js';
import { TaskConflictError, addTask, setTaskStatus } from './desk/tasks.js';
import { PlanConflictError, setPlanStatus } from './desk/plans.js';

// ── Resolve workspace root ─────────────────────────────────────────────
const WORKSPACE_ROOT = findWorkspaceRoot();
const config = loadConfig();
const TOKEN = generateToken();
const bridge = new WorkspaceBridge(WORKSPACE_ROOT);
// What each project-bound chat is doing right now; the desk floor shows it as a pose.
const activity = new ActivityRegistry();

// ── Agent mode (ADR-0019 §4): the host is the single browser-facing origin ──
// `ws web --agent` sets these. Without them the host is a standalone app as before.
const AGENT_MODE = process.env.WS_AGENT_MODE === '1';
const CONTROL_URL = process.env.WS_CONTROL_URL ?? '';
const CONTROL_TOKEN = process.env.WS_CONTROL_TOKEN ?? '';
const DESK_DIST = process.env.WS_DESK_DIST ?? '';
// The host's own API lives under this prefix, so it never collides with the control-plane
// `/api/*` the host proxies.
const AGENT_API = '/api/agent';

// ── Provider registry ──────────────────────────────────────────────────
function getAdapters(cfg: AppConfig): Map<string, ProviderAdapter> {
  const adapters = new Map<string, ProviderAdapter>();
  if (cfg.providers.openai?.apiKey) {
    adapters.set('openai', createOpenAIAdapter(cfg.providers.openai));
  }
  if (cfg.providers.anthropic?.apiKey) {
    adapters.set('anthropic', createAnthropicAdapter(cfg.providers.anthropic));
  }
  if (cfg.providers.google?.apiKey) {
    adapters.set('google', createGeminiAdapter(cfg.providers.google));
  }
  return adapters;
}

let adapters = getAdapters(config);

// ── Endpoints by wire protocol (ADR-0021): <workspace>/.local/agent/endpoints.json ──
function safeLoadEndpoints(): Endpoint[] {
  try {
    return loadEndpoints(WORKSPACE_ROOT);
  } catch (err) {
    console.error(`Endpoints disabled: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
const endpoints = safeLoadEndpoints();

// ── System prompt with workspace awareness ─────────────────────────────
const SYSTEM_PROMPT = `You are Agent Control, an AI-powered workspace assistant.
You help the user understand and navigate their Agent-Workspace — its projects,
context, memory, runs, tasks, and code.

Workspace root: ${WORKSPACE_ROOT}

You have access to the following tools:
- list_projects: List all registered projects in the workspace
- project_tree: Show the client > group > project hierarchy
- context_pack: Load the full context pack for a specific project
- read_file: Read a file within the workspace (sandboxed)
- search_code: Search for patterns in project files using ripgrep
- route_skills: Get skill recommendations for a given task
- get_skill: Read the full instructions and standards for any workspace skill (from Agent-Skills / .agents/skills)
- diagnose_database: Inspect PostgreSQL health, locks, active queries, invalid/unused indexes, and XID wraparound using dbakit
- diagnose_infra: Inspect Linux host, Docker, Swarm, and Kubernetes SRE diagnostics using opskit
- scan_security: Run security audits (secrets, CVEs) on a project using agent-secure

When answering questions:
- Be concise but thorough
- Reference specific files and line numbers when discussing code
- Use markdown formatting for clarity
- If you don't know something, say so rather than guessing

UIDL Generative UI:
When the user asks you to design, build, or display a UI (such as dashboards, metric cards, diagnostics summaries, forms, or task lists), you can output an interactive UIDL document inside a \`\`\`uidl code block. The client will automatically render it live as an interactive UI widget!
Example UIDL format:
\`\`\`uidl
{
  "$schema": "https://agent-workspace.dev/uidl/v1",
  "version": "1.0",
  "id": "sample-ui",
  "name": "Sample UI",
  "root": {
    "id": "root",
    "type": "Container",
    "props": { "className": "stack" },
    "children": [
      { "id": "heading", "type": "Text", "props": { "value": "Dashboard", "heading": 2 } },
      { "id": "stat-box", "type": "Container", "props": { "className": "stat stat-accent" }, "children": [
        { "id": "l1", "type": "Text", "props": { "value": "Status", "className": "eyebrow" } },
        { "id": "v1", "type": "Text", "props": { "value": "Operational", "className": "stat-value" } }
      ]}
    ]
  }
}
\`\`\`

You are running locally on the user's machine. This is a private, loopback-only
session. Treat all workspace data as confidential.`;

// ── Hono app ───────────────────────────────────────────────────────────
const app = new Hono();

// Global middleware
app.use('*', loopbackOnly());
app.use('*', securityHeaders());

// API routes require token
app.use('/api/agent/*', tokenAuth(TOKEN));
app.use('/api/agent/*', rateLimit(120, 60_000));

// ── API: Providers & models ────────────────────────────────────────────
app.get(`${AGENT_API}/providers`, (c) => {
  const endpointIds = new Set(endpoints.map((e) => e.name));
  const available = availableProviders(config).filter((key) => !endpointIds.has(key));
  const providers = [
    ...endpoints.map((e) => ({
      id: e.name,
      name: `${e.name} (${e.protocol}, ${e.locality})`,
      models: e.models,
      locality: e.locality,
    })),
    ...available.map((key) => {
      const adapter = adapters.get(key);
      const baseUrl = config.providers[key as keyof AppConfig['providers']]?.baseUrl;
      return {
        id: key,
        name: adapter?.name ?? key,
        models: adapter?.models() ?? [],
        locality: baseUrl ? localityOf(baseUrl) : 'remote',
      };
    }),
  ];
  return c.json({
    providers,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
  });
});

// ── API: Config management ─────────────────────────────────────────────
app.get(`${AGENT_API}/config`, (c) => {
  // Return config without exposing full API keys
  const masked = { ...config };
  masked.providers = Object.fromEntries(
    Object.entries(config.providers).map(([k, v]) => [
      k,
      v ? { apiKey: v.apiKey ? `${v.apiKey.slice(0, 8)}...` : '', baseUrl: v.baseUrl } : undefined,
    ])
  );
  return c.json(masked);
});

app.post(`${AGENT_API}/config`, async (c) => {
  const body = await c.req.json() as Partial<AppConfig>;
  if (body.providers) {
    for (const [key, val] of Object.entries(body.providers)) {
      if (val?.apiKey && !val.apiKey.includes('...')) {
        (config.providers as Record<string, typeof val>)[key] = val;
      }
    }
  }
  if (body.defaultProvider) config.defaultProvider = body.defaultProvider;
  if (body.defaultModel) config.defaultModel = body.defaultModel;
  saveConfig(config);
  adapters = getAdapters(config);
  return c.json({ ok: true });
});

// ── API: Chat (streaming) ──────────────────────────────────────────────
app.post(`${AGENT_API}/chat`, async (c) => {
  const body = await c.req.json() as {
    messages: ModelMessage[];
    provider?: string;
    model?: string;
    /** Project whose context this chat works with; decides which endpoints may receive it. */
    project?: string;
    /** When set, the turn is kept in this conversation's history (server/conversations.ts). */
    conversation?: string;
  };

  const resolved = resolveChatModel({
    provider: body.provider ?? config.defaultProvider,
    model: body.model ?? config.defaultModel,
    project: body.project,
  }, {
    root: WORKSPACE_ROOT,
    endpoints,
    adapters,
    legacyBaseUrls: Object.fromEntries(Object.entries(config.providers).map(([id, p]) => [id, p?.baseUrl])),
  });
  if ('error' in resolved) {
    return c.json({ error: resolved.error }, resolved.status);
  }

  // A chat bound to a project sees only that project (ADR-0011): an endpoint allowed for
  // one project must not be handed another project's files through the tools.
  let scope: ChatScope | undefined;
  if (body.project) {
    const project = parseProjectList(await bridge.listProjects().catch(() => '')).find((p) => p.key === body.project);
    if (!project) return c.json({ error: `Unknown project "${body.project}".` }, 400);
    const coding = readCodingSession(WORKSPACE_ROOT, project.key);
    scope = {
      root: WORKSPACE_ROOT,
      project: project.key,
      folder: project.folder,
      remote: resolved.locality === 'remote',
      worktree: coding?.worktree,
    };
  }

  // History, when the client asked for it: this turn's user message now, the answer when
  // the turn ends. A conversation id that belongs to another scope is refused here.
  const conversation = isConversationId(body.conversation) ? body.conversation : undefined;
  const historyScope = scope?.project ?? WORKSPACE_SCOPE;
  const lastMessage = body.messages.at(-1);
  if (conversation && lastMessage?.role === 'user' && typeof lastMessage.content === 'string') {
    try {
      appendMessage(WORKSPACE_ROOT, historyScope, conversation, { role: 'user', content: lastMessage.content, at: new Date().toISOString() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }

  try {
    const model = resolved.model;

    const start = new Date().toISOString();
    const result = streamText({
      model,
      system: scope
        ? `${SYSTEM_PROMPT}\n\nThis chat is bound to project "${scope.project}" (folder ${scope.folder}). `
          + 'Only that project, its memory and runs, and the framework are available; do not ask for other projects.'
          + (scope.worktree
            ? ` A coding session is active in ${scope.worktree}. write_file, edit_file, run_command, `
              + 'read_file, and search_code all act there, not in the project\'s main checkout; git_diff shows '
              + 'the session\'s changes so far.'
            : '')
        : SYSTEM_PROMPT,
      messages: body.messages,
      tools: createChatTools(bridge, scope),
      stopWhen: stepCountIs(5),
    });

    // Our own line protocol (server/stream-protocol.ts): the UI does not depend on the
    // AI SDK's wire format, which changes with every major version.
    const provider = body.provider ?? config.defaultProvider;
    const usage = (finish: StreamFinish) => {
      try {
        recordUsage(WORKSPACE_ROOT, {
          tool: 'agent-control',
          endpoint: provider,
          model: body.model ?? config.defaultModel,
          locality: resolved.locality,
          ...(scope ? { project: scope.project, projectRoot: join(WORKSPACE_ROOT, scope.folder) } : {}),
          start,
          end: new Date().toISOString(),
          ...finish,
        });
      } catch (err) {
        console.error('Usage record not written:', err instanceof Error ? err.message : String(err));
      }
    };
    const tapped = scope ? activity.tap(scope.project, result.fullStream) : result.fullStream;
    const parts = conversation
      ? captureAssistant(tapped, (message) => {
        try {
          appendMessage(WORKSPACE_ROOT, historyScope, conversation, message);
        } catch (err) {
          console.error('History not written:', err instanceof Error ? err.message : String(err));
        }
      })
      : tapped;
    return new Response(toLineStream(parts, usage), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Chat error:', message);
    return c.json({ error: message }, 500);
  }
});

// ── API: Conversation history (server/conversations.ts) ────────────────
// The latest conversation of a scope: a project key, or `_workspace` for an unbound chat.
app.get(`${AGENT_API}/conversations/latest`, (c) => {
  const scope = c.req.query('scope') ?? '';
  if (!isScope(scope)) return c.json({ error: 'scope is a project key or _workspace' }, 400);
  const latest = latestConversation(WORKSPACE_ROOT, scope);
  return c.json(latest ?? { id: null, messages: [] });
});

// ── API: Projects a chat can be bound to ───────────────────────────────
app.get(`${AGENT_API}/projects`, async (c) => {
  const projects = parseProjectList(await bridge.listProjects().catch(() => ''));
  return c.json({
    projects: projects.map((p) => {
      let allowedEndpoints: string[] | null = null;
      try {
        allowedEndpoints = loadLlmAllowlist(WORKSPACE_ROOT, p.key);
      } catch {
        // an invalid key never has a policy
      }
      return { key: p.key, client: p.client, folder: p.folder, allowedEndpoints };
    }),
  });
});

// ── API: Local approvals (ADR-0020) ─────────────────────────────────────
// The project key is validated by listPending/decide (policy.ts's policyPath); an
// invalid one is reported as a 400, not a path a bad request could use to probe disk.
app.get(`${AGENT_API}/approvals`, (c) => {
  const project = c.req.query('project');
  if (!project) return c.json({ error: 'project is required' }, 400);
  try {
    return c.json({ pending: listPending(WORKSPACE_ROOT, project) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post(`${AGENT_API}/approvals/decide`, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { project?: string; id?: string; decision?: string };
  if (!body.project || !body.id || (body.decision !== 'approved' && body.decision !== 'denied')) {
    return c.json({ error: 'project, id, and decision ("approved" or "denied") are required' }, 400);
  }
  try {
    const ok = decide(WORKSPACE_ROOT, body.project, body.id, body.decision);
    return ok ? c.json({ ok: true }) : c.json({ error: 'unknown, already decided, or expired request' }, 409);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// ── API: Coding sessions (ADR-0019) ─────────────────────────────────────
// One active session per project; its worktree is where write_file/edit_file/git_diff
// and run_command then act, in place of the primary checkout.
app.get(`${AGENT_API}/coding-sessions/:project`, (c) => {
  try {
    return c.json({ session: readCodingSession(WORKSPACE_ROOT, c.req.param('project')) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post(`${AGENT_API}/coding-sessions/:project/start`, async (c) => {
  try {
    const session = await startCodingSession(WORKSPACE_ROOT, c.req.param('project'), realSessionRunner(WORKSPACE_ROOT));
    return c.json({ session });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// The session's changes so far, for the person reviewing them: read-only and capped, so a
// generated file cannot flood the browser. The worktree is the session's, never the checkout.
const DIFF_MAX = 400_000;
app.get(`${AGENT_API}/coding-sessions/:project/diff`, async (c) => {
  try {
    const session = readCodingSession(WORKSPACE_ROOT, c.req.param('project'));
    if (!session) return c.json({ session: null, diff: '', truncated: false });
    const diff = await gitDiff(session.worktree);
    return c.json({ session, diff: diff.slice(0, DIFF_MAX), truncated: diff.length > DIFF_MAX });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post(`${AGENT_API}/coding-sessions/:project/stop`, async (c) => {
  try {
    const stopped = await stopCodingSession(WORKSPACE_ROOT, c.req.param('project'), realSessionRunner(WORKSPACE_ROOT));
    return c.json({ stopped });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// ── API: Workspace info ────────────────────────────────────────────────
app.get(`${AGENT_API}/workspace`, async (c) => {
  try {
    const [projects, tree] = await Promise.all([
      bridge.listProjects().catch(() => 'Could not load projects'),
      bridge.tree().catch(() => 'Could not load tree'),
    ]);
    return c.json({ root: WORKSPACE_ROOT, projects, tree });
  } catch {
    return c.json({ root: WORKSPACE_ROOT, projects: '', tree: '' });
  }
});

// ── API: Desk (docs/desk/README.md) ────────────────────────────────────
// Read-only: the floor, and the record sets the drawer sections bind UIDL tables to.
app.get(`${AGENT_API}/desk/floor`, (c) => c.json(deskFloor(WORKSPACE_ROOT, activity)));

// The desk's writes go through `ws`, never straight to a file (ADR-0019 §2, ADR-0023).
app.post(`${AGENT_API}/desk/notes`, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return c.json(await addNote(realWsInputRunner(WORKSPACE_ROOT), { project: body.project, title: body.title, body: body.body }));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post(`${AGENT_API}/desk/tasks`, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return c.json(await addTask(realWsInputRunner(WORKSPACE_ROOT), body));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post(`${AGENT_API}/desk/tasks/status`, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return c.json(await setTaskStatus(realWsInputRunner(WORKSPACE_ROOT), body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, err instanceof TaskConflictError ? 409 : 400);
  }
});

app.post(`${AGENT_API}/desk/plan/status`, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return c.json(await setPlanStatus(realWsInputRunner(WORKSPACE_ROOT), body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, err instanceof PlanConflictError ? 409 : 400);
  }
});

// The live floor: a new floor only when something on it changed, as server-sent events.
// The desk reads it with fetch, so the bearer token stays in a header, never in a URL.
app.get(`${AGENT_API}/desk/events`, (c) => streamSSE(c, async (stream) => {
  for await (const event of floorEvents({
    read: () => deskFloor(WORKSPACE_ROOT, activity),
    sleep: (ms) => stream.sleep(ms).then(() => undefined),
    stopped: () => stream.aborted || stream.closed,
  })) {
    await stream.writeSSE(event);
  }
}));

app.get(`${AGENT_API}/desk/collections/:name`, (c) => {
  const name = c.req.param('name');
  if (!isCollection(name)) return c.json({ error: `unknown collection '${name}'` }, 404);
  const params = c.req.query();
  // `eq.<field>=<value>` is an equality filter; `sort=<field>:<asc|desc>`.
  const equals = Object.fromEntries(Object.entries(params)
    .filter(([key]) => key.startsWith('eq.'))
    .map(([key, value]) => [key.slice(3), value]));
  const [sortField, sortDir] = (params.sort ?? '').split(':');
  try {
    const rows = readCollection(WORKSPACE_ROOT, name, params.project || undefined, deskFloor(WORKSPACE_ROOT, activity));
    return c.json(queryRows(rows, {
      search: params.search,
      equals,
      sort: sortField ? { field: sortField, dir: sortDir === 'desc' ? 'desc' : 'asc' } : undefined,
      page: params.page ? Number(params.page) : undefined,
      pageSize: params.pageSize ? Number(params.pageSize) : undefined,
    }));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// ── Agent mode: proxy the control-plane API (ADR-0019 §4) ──────────────
// Registered after the host's own /api/agent/* routes, so they always win. The browser
// never holds the control-plane token: the proxy presents it and rewrites Host/Origin.
if (AGENT_MODE && CONTROL_URL) {
  app.all('/api/*', (c) =>
    forwardToControl(c.req.raw, { controlUrl: CONTROL_URL, controlToken: CONTROL_TOKEN }),
  );
}

// ── Serve static files in production ───────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const ownDist = resolve(import.meta.dirname ?? '.', '..', 'dist');
  // In agent mode the browser loads the workspace desk (WS_DESK_DIST); otherwise the host
  // serves its own UI. Falls back to its own dist if the desk build is missing.
  const deskDist = AGENT_MODE && DESK_DIST && existsSync(DESK_DIST) ? DESK_DIST : '';
  const distPath = deskDist || ownDist;
  if (existsSync(distPath)) {
    app.get('*', (c) => {
      const url = new URL(c.req.url);
      let filePath = join(distPath, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!existsSync(filePath)) filePath = join(distPath, 'index.html');
      // Inject token into HTML
      if (filePath.endsWith('.html')) {
        let html = readFileSync(filePath, 'utf-8');
        // The inline script needs a nonce to run under the response's own CSP, which
        // `securityHeaders()` reads back from here. A fresh one per response, and the HTML
        // is not cacheable: a cached copy would carry a stale nonce and lose the token.
        const nonce = crypto.randomBytes(16).toString('base64');
        setScriptNonce(c, nonce);
        html = html.replace(
          '</head>',
          `<script nonce="${nonce}">window.__AC_TOKEN__="${TOKEN}";</script></head>`
        );
        c.header('Cache-Control', 'no-store');
        return c.html(html);
      }
      const content = readFileSync(filePath);
      const ext = filePath.split('.').pop() ?? '';
      const mimeTypes: Record<string, string> = {
        js: 'application/javascript',
        css: 'text/css',
        svg: 'image/svg+xml',
        png: 'image/png',
        ico: 'image/x-icon',
        woff2: 'font/woff2',
      };
      c.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      return c.body(content);
    });
  }
}

// ── Start server ───────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3141', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  const url = `http://${HOST}:${PORT}?token=${TOKEN}`;
  console.log('');
  console.log('  ╭──────────────────────────────────────────╮');
  console.log('  │                                          │');
  console.log('  │   Agent Control                          │');
  console.log('  │                                          │');
  console.log(`  │   Local:  http://${HOST}:${PORT}         │`);
  console.log('  │                                          │');
  console.log(`  │   Workspace: ${WORKSPACE_ROOT.split('/').pop()}  │`);
  console.log(`  │   Providers: ${availableProviders(config).join(', ') || 'none configured'}  │`);
  console.log('  │                                          │');
  console.log('  ╰──────────────────────────────────────────╯');
  console.log('');
  console.log(`  Open: ${url}`);
  console.log('');
});
