# Agent-Control

AI-powered workspace assistant with multi-provider LLM support.

A standalone, loopback-only chat interface that understands your Agent-Workspace
projects, context, memory, and runs. It connects to OpenAI, Anthropic, and
Google Gemini — all from one unified interface.

## Quick start

```bash
# From the workspace root or this directory:
npm install
npm run dev
# Open the URL printed in the terminal (includes auth token)
```

## Features

- **Multi-provider LLM** — GPT-4o, Claude Sonnet/Opus, Gemini Pro/Flash
- **Workspace-aware** — knows your projects, context, memory, and runs via `ws` CLI
- **Tool-Calling Diagnostic Suite** — integrated with `dbakit` (PostgreSQL), `opskit` (Linux/Docker/K8s), and `agent-secure` (security audits)
- **Authoritative Skill Retrieval** — `get_skill` powered by `Agent-Skills` (48 standardized software engineering workflows)
- **Generative UIDL UI Preview** — live in-chat interactive rendering of UIDL documents (`uidl-runtime`) for metrics, forms, and cards
- **Studio Handoff** — one-click `Studio ↗` direct export into `UIDL-Builder` for visual drag-and-drop customization
- **Streaming chat** — real-time SSE streaming with markdown rendering
- **Code-aware** — syntax highlighting, file previews, search results
- **Secure** — loopback-only, process-token auth, no secrets in source

## Configuration

Create `~/.agent-control/config.json` (or use the in-app settings):

```json
{
  "providers": {
    "openai": { "apiKey": "sk-..." },
    "anthropic": { "apiKey": "sk-ant-..." },
    "google": { "apiKey": "AIza..." }
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514"
}
```

API keys are never stored in this repository. The config file lives outside
the project directory and is git-ignored.

### Endpoints by wire protocol

Any vendor, router, or local server that speaks one of three protocols is added by
configuration, not code: `openai-chat` (Chat Completions and compatible APIs, e.g. xAI,
OpenRouter, Ollama, vLLM), `openai-responses`, and `anthropic-messages`. A `mock`
protocol answers deterministically and offline, for tests and demos.

`<workspace>/.local/agent/endpoints.json` (outside every repository):

```json
{
  "endpoints": {
    "anthropic": { "protocol": "anthropic-messages", "baseUrl": "https://api.anthropic.com/v1",
                   "apiKey": "env:ANTHROPIC_API_KEY", "models": ["claude-sonnet-5-5"] },
    "xai":       { "protocol": "openai-chat", "baseUrl": "https://api.x.ai/v1",
                   "apiKey": "env:XAI_API_KEY", "models": ["<model>"] },
    "local":     { "protocol": "openai-chat", "baseUrl": "http://127.0.0.1:11434/v1",
                   "models": ["<model>"] },
    "mock":      { "protocol": "mock", "models": ["echo"] }
  }
}
```

`apiKey` is a reference, `env:NAME` or `keychain:NAME` (macOS Keychain); a literal key
is rejected. An endpoint replaces a legacy provider with the same id.

**Egress per project (Agent-Workspace ADR-0021).** Locality is derived from the URL:
loopback is `local`, everything else `remote`. A local endpoint is always allowed. A
remote endpoint is called only for a chat that names a `project` whose operator policy
lists it, in `<workspace>/.local/agent/policies/<project>.json`:

```json
{ "schema_version": 1, "default": "read", "llm": { "endpoints": ["xai"] } }
```

Without that entry the request is refused with 403. `POST /api/chat` accepts
`"project": "<key>"` next to `provider` and `model`. Legacy providers from
`~/.agent-control/config.json` are not egress-checked; move them to endpoints.

## Architecture

- **Frontend**: React 19 + Vite + TypeScript + Vanilla CSS
- **Backend**: Hono (Node.js) with SSE streaming
- **LLM**: Vercel AI SDK with provider adapters
- **Workspace**: `ws` CLI bridge for project/context awareness

## Security

- Server binds to `127.0.0.1` only — no network exposure
- Bearer token generated per process — never stored in browser
- File reads sandboxed to workspace root
- CSP headers prevent script injection
- API keys stored outside project in user home directory

## License

MIT
