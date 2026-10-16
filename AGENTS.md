# Agent-Control

A standalone AI-powered workspace assistant. This is a product repo — it does
not modify the Agent-Workspace framework.

## Stack

React 19 + Vite + TypeScript frontend, Hono + Vercel AI SDK backend.
Multi-provider: OpenAI, Anthropic, Google Gemini. Streaming SSE chat with
markdown rendering and syntax highlighting.

## Rules

- Server MUST bind to 127.0.0.1 only. Never 0.0.0.0.
- The host's own API lives under `/api/agent/*`. `/api/*` is reserved: in agent mode
  (`WS_AGENT_MODE=1`) the host serves the desk and proxies `/api/*` to the control plane,
  so a new own endpoint never goes under bare `/api/`.
- API keys MUST live outside every repository: as `env:`/`keychain:` references in
  `<workspace>/.local/agent/endpoints.json`, or in `~/.agent-control/config.json`
  (legacy). Never in source, and never as a literal in endpoints.json.
- A remote endpoint is called only for a project whose policy lists it (ADR-0021).
  Tests use the `mock` protocol; they never call a real endpoint.
- A chat with a project gets tools bound to that project (ADR-0011). Any new tool that
  reads files or project data MUST be scoped in `server/tools/chat-tools.ts` `bindToProject`.
- Usage records hold counts and names, never prompt or answer text.
- Every mutating tool (`run_command`, `write_file`, `edit_file`); any new mutating tool
  goes through the same `classifyAction()` + approval flow, never a shortcut around it.
- A mutating tool for a coding session operates on `ChatScope.worktree`, never the
  primary checkout - see `server/tools/chat-tools.ts`'s `codingSessionTools()`.
- `read_file`/`search_code` also prefer `ChatScope.worktree` for a path under the
  project's own folder, once a coding session is active - see `readFileTool()`/
  `searchCodeTool()` in the same file. Never read a worktree through
  `WorkspaceBridge.readProjectFile()`/`.search()`; it deliberately refuses `.local/`
  paths, where every worktree lives - use `worktree-files.ts` instead.
- The desk's endpoints (`/api/agent/desk/*`, `server/desk/`) are read-only. Changes to
  context, memory, notes, tasks, or runs go through `ws` via `execFile` (ADR-0019 §2), never a
  direct file write. A floor pose comes from a recorded event, never a guess - see
  `docs/desk/README.md`.
- Conversation history (`server/conversations.ts`, `.local/agent/sessions/`) holds content:
  it never leaves the machine, never enters a usage record, and a conversation never changes
  scope - keep the scope check in `appendMessage`.
- No emojis in UI, logs, or docs; use SVG icons or text badges such as `[WARN]`.
- CI (`test`, `security / gate`) is required on `main`; merge through a PR.
- File reads MUST be sandboxed: resolved path must start with workspace root.
- Use `execFile` (not `exec`) for subprocess calls. Validate all arguments.
- React JSX for rendering — no `dangerouslySetInnerHTML`.
- CSS custom properties for theming — no Tailwind.
- All server responses include CSP, X-Frame-Options, X-Content-Type-Options.

## Layout

```
server/           Backend (Hono, loopback, SSE streaming)
  providers/      LLM provider adapters
  tools/          Workspace bridge, file reader, search
  desk/           Read-only floor model and drawer collections
  middleware/     Security, rate limiting
src/              Frontend (React)
  desk/           The desk: floor, drawers, UIDL sections (default UI)
  components/     Chat, sidebar, workspace, UI primitives
  hooks/          State management
  lib/            API client, types
```

## Develop

```bash
pnpm run dev       # concurrent server + client
pnpm run build     # production build
pnpm start         # production server
```
