import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamText, type CoreMessage } from 'ai';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { loadConfig, saveConfig, availableProviders, type AppConfig } from './config.js';
import { createOpenAIAdapter } from './providers/openai.js';
import { createAnthropicAdapter } from './providers/anthropic.js';
import { createGeminiAdapter } from './providers/gemini.js';
import type { ProviderAdapter } from './providers/types.js';
import { WorkspaceBridge, findWorkspaceRoot } from './tools/workspace.js';
import {
  generateToken,
  loopbackOnly,
  tokenAuth,
  securityHeaders,
  rateLimit,
} from './middleware/security.js';

// ── Resolve workspace root ─────────────────────────────────────────────
const WORKSPACE_ROOT = findWorkspaceRoot();
const config = loadConfig();
const TOKEN = generateToken();
const bridge = new WorkspaceBridge(WORKSPACE_ROOT);

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
app.use('/api/*', tokenAuth(TOKEN));
app.use('/api/*', rateLimit(120, 60_000));

// ── API: Providers & models ────────────────────────────────────────────
app.get('/api/providers', (c) => {
  const available = availableProviders(config);
  const providers = available.map((key) => {
    const adapter = adapters.get(key);
    return {
      id: key,
      name: adapter?.name ?? key,
      models: adapter?.models() ?? [],
    };
  });
  return c.json({
    providers,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
  });
});

// ── API: Config management ─────────────────────────────────────────────
app.get('/api/config', (c) => {
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

app.post('/api/config', async (c) => {
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
app.post('/api/chat', async (c) => {
  const body = await c.req.json() as {
    messages: CoreMessage[];
    provider?: string;
    model?: string;
  };

  const providerKey = body.provider ?? config.defaultProvider;
  const modelId = body.model ?? config.defaultModel;
  const adapter = adapters.get(providerKey);

  if (!adapter) {
    return c.json({
      error: `Provider "${providerKey}" is not configured. Add an API key in Settings.`,
    }, 400);
  }

  try {
    const model = adapter.model(modelId);

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: body.messages,
      tools: {
        list_projects: {
          description: 'List all registered projects in the workspace',
          parameters: {},
          execute: async () => {
            const output = await bridge.listProjects();
            return { content: output };
          },
        },
        project_tree: {
          description: 'Show the client > group > project hierarchy',
          parameters: {},
          execute: async () => {
            const output = await bridge.tree();
            return { content: output };
          },
        },
        context_pack: {
          description: 'Load the full context pack for a specific project',
          parameters: {
            type: 'object' as const,
            properties: {
              projectKey: {
                type: 'string' as const,
                description: 'The project key to load context for',
              },
            },
            required: ['projectKey'],
          },
          execute: async ({ projectKey }: { projectKey: string }) => {
            const output = await bridge.contextPack(projectKey);
            return { content: output };
          },
        },
        read_file: {
          description: 'Read a file within the workspace (sandboxed to workspace root)',
          parameters: {
            type: 'object' as const,
            properties: {
              path: {
                type: 'string' as const,
                description: 'Relative path from workspace root',
              },
            },
            required: ['path'],
          },
          execute: async ({ path }: { path: string }) => {
            const content = await bridge.readProjectFile(path);
            return { content };
          },
        },
        search_code: {
          description: 'Search for a pattern in project files using ripgrep',
          parameters: {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string' as const,
                description: 'Search pattern',
              },
              folder: {
                type: 'string' as const,
                description: 'Optional: restrict search to a project folder',
              },
            },
            required: ['query'],
          },
          execute: async ({ query, folder }: { query: string; folder?: string }) => {
            const output = await bridge.search(query, folder);
            return { content: output };
          },
        },
        route_skills: {
          description: 'Get skill recommendations from the workspace skill catalog for a given task',
          parameters: {
            type: 'object' as const,
            properties: {
              taskDescription: {
                type: 'string' as const,
                description: 'Description of the task to find matching skills for',
              },
              projectKey: {
                type: 'string' as const,
                description: 'Optional project key to search client-specific domain skills as well',
              },
            },
            required: ['taskDescription'],
          },
          execute: async ({ taskDescription, projectKey }: { taskDescription: string; projectKey?: string }) => {
            const output = await bridge.route(taskDescription, projectKey);
            return { content: output };
          },
        },
        get_skill: {
          description: 'Fetch the authoritative instructions and guidelines for a skill from Agent-Skills / .agents/skills (e.g. codebase-onboarding, rest-api-contract, quarkus-service, uidl-runtime)',
          parameters: {
            type: 'object' as const,
            properties: {
              skillName: {
                type: 'string' as const,
                description: 'The name of the skill, e.g. "codebase-onboarding", "rest-api-contract", or "uidl-runtime"',
              },
            },
            required: ['skillName'],
          },
          execute: async ({ skillName }: { skillName: string }) => {
            const content = await bridge.readSkill(skillName);
            return { content };
          },
        },
        diagnose_database: {
          description: 'Inspect PostgreSQL database health, performance, active queries, blocking locks, unused/invalid indexes, or XID wraparound using dbakit (strictly read-only)',
          parameters: {
            type: 'object' as const,
            properties: {
              command: {
                type: 'string' as const,
                description: 'The dbakit probe to run: health, diagnose, sessions, locks, indexes, xid, replication, databases, config, rules, version',
              },
              flags: {
                type: 'array' as const,
                items: { type: 'string' as const },
                description: 'Optional flags, e.g. ["--unused-min-size=10485760"] or ["--top-tables=10"]',
              },
            },
            required: ['command'],
          },
          execute: async ({ command, flags }: { command: string; flags?: string[] }) => {
            const output = await bridge.dbakit(command, flags);
            return { content: output };
          },
        },
        diagnose_infra: {
          description: 'Inspect Linux host, Docker, Swarm, and Kubernetes infrastructure diagnostics using opskit (strictly read-only)',
          parameters: {
            type: 'object' as const,
            properties: {
              command: {
                type: 'string' as const,
                description: 'The opskit command: diag, audit, net, metrics, explain, version',
              },
              target: {
                type: 'string' as const,
                description: 'Optional target subsystem: host, docker, swarm, k8s, sec',
              },
              flags: {
                type: 'array' as const,
                items: { type: 'string' as const },
                description: 'Optional CLI flags',
              },
            },
            required: ['command'],
          },
          execute: async ({ command, target, flags }: { command: string; target?: string; flags?: string[] }) => {
            const output = await bridge.opskit(command, target, flags);
            return { content: output };
          },
        },
        scan_security: {
          description: 'Run security scanner and policy verification across a workspace project using agent-secure (ws scan)',
          parameters: {
            type: 'object' as const,
            properties: {
              projectKey: {
                type: 'string' as const,
                description: 'The project key to run security audit against',
              },
              doctor: {
                type: 'boolean' as const,
                description: 'Set to true to verify scanner installations without running a full scan',
              },
              policy: {
                type: 'string' as const,
                description: 'Optional custom policy file path',
              },
            },
            required: ['projectKey'],
          },
          execute: async ({ projectKey, doctor, policy }: { projectKey: string; doctor?: boolean; policy?: string }) => {
            const output = await bridge.agentSecure(projectKey, { doctor, policy });
            return { content: output };
          },
        },
      },
      maxSteps: 5,
    });

    // Stream the response using AI SDK's built-in data stream protocol
    return result.toDataStreamResponse({
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Chat error:', message);
    return c.json({ error: message }, 500);
  }
});

// ── API: Workspace info ────────────────────────────────────────────────
app.get('/api/workspace', async (c) => {
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

// ── Serve static files in production ───────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = resolve(import.meta.dirname ?? '.', '..', 'dist');
  if (existsSync(distPath)) {
    app.get('*', (c) => {
      const url = new URL(c.req.url);
      let filePath = join(distPath, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!existsSync(filePath)) filePath = join(distPath, 'index.html');
      // Inject token into HTML
      if (filePath.endsWith('.html')) {
        let html = readFileSync(filePath, 'utf-8');
        html = html.replace(
          '</head>',
          `<script>window.__AC_TOKEN__="${TOKEN}";</script></head>`
        );
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
  console.log('  │   🤖 Agent Control                       │');
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
