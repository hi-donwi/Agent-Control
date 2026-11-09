# Agent-Control

Agent-Control is the host and operator UI for the Agent Workspace Suite. Model inference
runs through Agent Brain.

A loopback-only assistant and workspace control surface that understands your Agent-Workspace
projects, context, memory, and runs. Every model call goes through the Agent Brain
gateway, which owns the provider accounts, keys, and routing; Agent-Control never calls a
provider directly.

Suite boundaries and the phased packaging plan are in
[docs/suite-architecture.md](docs/suite-architecture.md). The current desktop build includes
the Agent-Control host only; component readiness is visible in Settings, but installation and
updates remain operator-managed.

## Desk

The default UI is the **desk**: the workspace as a 2D floor - clients as zones, projects as
rooms, agents as animated figures whose pose shows what they are doing, with a raised hand
when one needs you. Two icons at the top right open the menu drawer (sections rendered by
`uidl-runtime`) and the assistant drawer. `/?ui=classic` keeps the previous chat layout.
Design, states, and phases: [docs/desk/README.md](docs/desk/README.md); wireframes:
[docs/desk/wireframe.md](docs/desk/wireframe.md).

## Quick start

Requires [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on `PATH` - `search_code`
shells out to it. Without it, `search_code` silently reports "No results found." rather
than failing loudly; CI installs it explicitly for the same reason.

```bash
# From the workspace root or this directory:
corepack pnpm install --frozen-lockfile
pnpm run dev
# Open the URL printed in the terminal (includes auth token)
```

## Features

- **Inference through Agent Brain** — every chat turn goes to the Brain gateway; providers, accounts, and keys live in Brain, not here
- **Workspace-aware** — knows your projects, context, memory, and runs via `ws` CLI
- **Tool-Calling Diagnostic Suite** — integrated with `dbakit` (PostgreSQL), `opskit` (Linux/Docker/K8s), and `agent-secure` (security audits)
- **Authoritative Skill Retrieval** — `get_skill` reads the Agent-Skills catalog synchronized into the selected workspace
- **Generative UIDL UI Preview** — live in-chat interactive rendering of UIDL documents (`uidl-runtime`) for metrics, forms, and cards
- **Studio Handoff** — one-click `Studio ↗` direct export into `UIDL-Builder` for visual drag-and-drop customization
- **Streaming chat** — real-time SSE streaming with markdown rendering
- **Code-aware** — syntax highlighting, file previews, search results
- **Secure** — loopback-only, process-token auth, no secrets in source

## Configuration

### Agent Brain is the only chat path

Chat inference runs only through Agent Brain
([docs/specs/agent-brain-routed-sessions.md](docs/specs/agent-brain-routed-sessions.md)).
Brain owns provider accounts, credentials, local models, and routing; Agent-Control sends
it the conversation and runs the tools itself. There is no direct provider path and no API
key field: when Brain is down or refuses a request, the chat shows the error and never
falls back to a provider SDK.

An Agent Brain endpoint is declared in `<workspace>/.local/agent/endpoints.json` (outside
every repository) with `"purpose": "agent-brain"`. A `mock` endpoint answers
deterministically and offline, for tests and demos:

```json
{
  "endpoints": {
    "brain": { "protocol": "openai-chat", "baseUrl": "http://127.0.0.1:52140/v1",
               "apiKey": "file:~/.lokal/agent-control.token", "locality": "remote", "purpose": "agent-brain",
               "routingProfile": { "id": "agent-control", "revision": "sha256:<64 lowercase hex characters>" } },
    "mock":  { "protocol": "mock", "models": ["echo"] }
  }
}
```

`apiKey` is a reference: `env:NAME`, `keychain:NAME` (macOS Keychain), or `file:PATH` for
a token file that only its owner can read (`chmod 600`; an absolute path or `~/...`). A
literal key is rejected. For Brain, issue a profile-scoped credential on the Brain host
with `brain router credential agent-control --protocol chat`; it writes the token and a
non-secret profile manifest under `~/.lokal/`. Never use `serve.token` as an Agent-Control
credential. The profile ID/revision must match both Brain's current `routing_profiles`
configuration and this workspace's project policy below. The file may also list endpoints of other protocols
(`openai-chat`, `openai-responses`, `anthropic-messages`) for other workspace tools; the
chat lists none of them and refuses a request that names one.

**Brain is remote.** `brain serve` listens on loopback but forwards requests to cloud
accounts, so an Agent Brain endpoint must be declared `"locality": "remote"`; a project's
context then reaches it only when that project's policy lists it (below). When
`~/.lokal/agent-control.token` and its `.json` profile manifest exist and no endpoint is
named `lokal`, the host adds that gateway as `lokal`, remote and with the Agent Brain purpose.
List real model ids from
`GET /v1/models`; a project-bound chat also asks Brain for them once the project's policy
allows it.

`~/.agent-control/config.json` holds only the endpoint and model a new chat starts with;
the app reads it and never writes it:

```json
{ "defaultProvider": "brain", "defaultModel": "antigravity/gemini-3-flash" }
```

A default that is not an Agent Brain endpoint falls back to the first one. Provider keys
left in that file from earlier versions are ignored; the server names the providers once
at startup (never the keys) so the entry can be removed.

**A silent model ends the turn.** A chat turn gives up when a model call sends nothing for
180 s before its first output (queueing and prompt processing included) or for 120 s between
outputs; the browser then shows "The model request timed out." and the upstream request is
closed. Pressing Stop closes it as well. A slow endpoint, such as a CPU-only model VM, can
wait longer:

```json
"vm": { "protocol": "openai-chat", "baseUrl": "http://127.0.0.1:52141/v1",
        "timeouts": { "firstChunkMs": 600000, "chunkMs": 300000 }, "models": ["<model>"] }
```

Model errors reach the browser and the server log as a fixed message with the HTTP status
only (for example "The model endpoint is rate limited (HTTP 429)"); the upstream body, URL,
and the prompt are never shown or logged.

**Egress per project (Agent-Workspace ADR-0021).** Locality is derived from the URL:
loopback is `local`, everything else `remote`, and a loopback gateway that forwards to the
cloud is declared remote. A local endpoint is always allowed. A remote endpoint is called
only for a chat that names a `project` whose operator policy lists it, in
`<workspace>/.local/agent/policies/<project>.json`:

```json
{
  "schema_version": 1,
  "default": "read",
  "llm": {
    "endpoints": ["brain"],
    "brain_profiles": [
      { "endpoint": "brain", "profile_id": "agent-control", "revision": "sha256:<same revision as endpoint config>" }
    ]
  }
}
```

Both the endpoint name and exact profile revision must be allowed; an endpoint-only grant,
missing profile grant, or stale revision is refused with 403 before network egress.
`POST /api/agent/chat` accepts
`"project": "<key>"` next to `provider` and `model`; the sidebar's **Project** selector
sends it, and disables endpoints the project may not use.

**A chat bound to a project sees only that project** (Agent-Workspace ADR-0011). Its
tools cannot list other projects, load another project's context pack, or read outside
the project's folder, its memory and runs, and the framework (`.agents`, `docs`,
`AGENTS.md`); search stays in the project folder; host diagnostics are not offered to a
remote model. Switching project starts a new conversation. `GET /api/agent/projects` lists the
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
  `GET /api/agent/approvals?project=<key>` lists pending requests; `POST /api/agent/approvals/decide`
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
POST /api/agent/coding-sessions/<project>/start   -> starts one, or returns the active one
GET  /api/agent/coding-sessions/<project>         -> the active session, or null
POST /api/agent/coding-sessions/<project>/stop    -> stops it (the worktree is kept, for review)
```

One session per project at a time. Once active, every tool that touches the project's
source moves to the worktree: `write_file` and `edit_file` (both gated like
`run_command`), `git_diff`, `run_command`'s commands, and `read_file`/`search_code` -
the chat sees its own edits, not the unedited primary checkout. Reads of the project's
memory, runs, or the framework itself are unaffected; a coding session never changes
those.

## Web control desk mode

`ws web --agent` starts this host beside the Agent-Workspace control plane (ADR-0019) and
makes it the single browser-facing origin:

- `/` serves the workspace control desk (`WS_DESK_DIST`).
- `/api/agent/*` is this host's own API (chat, providers, projects, approvals, coding
  sessions, workspace).
- every other `/api/*` is proxied to the control plane (`WS_CONTROL_URL`) with the internal
  token (`WS_CONTROL_TOKEN`), rewriting `Host` and dropping the browser's `Origin` and
  `Sec-Fetch-*` headers. The browser never receives the control-plane token.

Without `WS_AGENT_MODE=1` the host is a standalone app: it serves its own UI at `/` and
answers its API at `/api/agent/*`.

## Architecture

- **Frontend**: React 19 + Vite + TypeScript + Vanilla CSS
- **Backend**: Hono (Node.js) with SSE streaming
- **LLM**: Vercel AI SDK 7; the chat streams Agent-Control's own line protocol (`server/stream-protocol.ts`)
- **Workspace**: `ws` CLI bridge for project/context awareness

## Testing

```bash
pnpm test      # node:test through tsx; makes no network call
pnpm lint
pnpm build
```

`server/chat.e2e.test.ts` starts the real entry point (`server/index.ts`) against a
disposable workspace whose `mock` endpoint answers deterministically and offline, then
drives `POST /api/agent/chat` over HTTP. The whole chat path - loopback gate, token,
endpoint load, egress policy, the AI SDK stream, and the line protocol - runs with no
network call and no real provider. That is also the seam the browser harness drives.

### Browser harness (local only)

```bash
pnpm exec playwright install chromium   # once, or use PW_CHANNEL=chrome for an installed Chrome
pnpm test:ui
```

`test:ui` builds the UI, starts the same real entry point against a disposable workspace
(`test/ui/workspace.ts` - endpoint config, policy, seeded approvals and coding session, a
stub `ws`), and drives it in Chromium: the chat transcript, the approval inbox, the
coding-session control, the settings (no key field, and legacy keys that never reach the
page), the in-chat UIDL preview, and the token the server injects into a page whose URL has
none. No network call and no real provider, exactly like the server test.
It needs `git` on `PATH`, because a started session's branch is read from the fixture
worktree. CI runs `pnpm test`, not this, so the browser download stays off the runner; it is
typechecked all the same, since `tsc -b` covers `test/ui`.

## Security

- Server binds to `127.0.0.1` only — no network exposure
- Bearer token generated per process — handed to the page it serves, never persisted
- File reads sandboxed to workspace root
- CSP headers prevent script injection; the one injected token script runs behind a fresh
  per-response nonce, and the HTML that carries it is not cacheable
- No provider keys at all: Agent Brain holds them; endpoint credentials are references, never literals

## License

MIT
