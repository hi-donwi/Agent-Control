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

- **Multi-provider LLM** — any OpenAI-compatible, OpenAI Responses, or Anthropic endpoint by configuration, plus legacy OpenAI/Anthropic/Gemini settings
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
`"project": "<key>"` next to `provider` and `model`; the sidebar's **Project** selector
sends it, and disables providers the project may not use. Legacy providers from
`~/.agent-control/config.json` are checked the same way: remote unless their base URL is
loopback.

**A chat bound to a project sees only that project** (Agent-Workspace ADR-0011). Its
tools cannot list other projects, load another project's context pack, or read outside
the project's folder, its memory and runs, and the framework (`.agents`, `docs`,
`AGENTS.md`); search stays in the project folder; host diagnostics are not offered to a
remote model. Switching project starts a new conversation. `GET /api/projects` lists the
projects and the endpoints each one allows.

**Usage.** Every finished chat appends one line to
`<workspace>/.local/agent/usage/<YYYY-MM>.jsonl`: endpoint, model, locality, project,
start/end, finish reason, and token totals - never the prompt or the answer.

### `run_command`: policy-gated, approval-aware

A project-bound chat can run a command in its own project folder with the `run_command`
tool. What it may do without a human is decided by the project's operator policy
(`.local/agent/policies/<project>.json`, Agent-Workspace ADR-0014):

```json
{ "schema_version": 1, "default": "approval-required", "actions": { "run_command": "change" } }
```

- `read` / `change`: the command runs immediately.
- `approval-required` (the default): the tool returns a request id instead of running.
  `GET /api/approvals?project=<key>` lists pending requests; `POST /api/approvals/decide`
  with `{"project", "id", "decision": "approved" | "denied"}` decides one. The model is
  told to relay the id and wait, then call the tool again with `approvalId` set.
- Before running, the approval is re-verified against the command, the project
  repository's current `HEAD`, and the policy file's hash *as they are right now*
  (Agent-Workspace ADR-0020). Any of the three changing since the request voids it; a
  decided approval runs at most once.
- A missing or invalid policy refuses the action - it is never run on uncertain footing.

### Coding sessions

A chat can work inside a `ws agent start` worktree instead of the project's primary
checkout (Agent-Workspace ADR-0019):

```
POST /api/coding-sessions/<project>/start   -> starts one, or returns the active one
GET  /api/coding-sessions/<project>         -> the active session, or null
POST /api/coding-sessions/<project>/stop    -> stops it (the worktree is kept, for review)
```

One session per project at a time. Once active, every tool that touches the project's
source moves to the worktree: `write_file` and `edit_file` (both gated like
`run_command`), `git_diff`, `run_command`'s commands, and `read_file`/`search_code` -
the chat sees its own edits, not the unedited primary checkout. Reads of the project's
memory, runs, or the framework itself are unaffected; a coding session never changes
those.

## Architecture

- **Frontend**: React 19 + Vite + TypeScript + Vanilla CSS
- **Backend**: Hono (Node.js) with SSE streaming
- **LLM**: Vercel AI SDK 7; the chat streams Agent-Control's own line protocol (`server/stream-protocol.ts`)
- **Workspace**: `ws` CLI bridge for project/context awareness

## Security

- Server binds to `127.0.0.1` only — no network exposure
- Bearer token generated per process — never stored in browser
- File reads sandboxed to workspace root
- CSP headers prevent script injection
- API keys stored outside project in user home directory

## License

MIT
