# Agent-Control

A standalone AI-powered workspace assistant. This is a product repo — it does
not modify the Agent-Workspace framework.

## Stack

React 19 + Vite + TypeScript frontend, Hono + Vercel AI SDK backend.
Multi-provider: OpenAI, Anthropic, Google Gemini. Streaming SSE chat with
markdown rendering and syntax highlighting.

## Rules

- Server MUST bind to 127.0.0.1 only. Never 0.0.0.0.
- API keys MUST live outside every repository: as `env:`/`keychain:` references in
  `<workspace>/.local/agent/endpoints.json`, or in `~/.agent-control/config.json`
  (legacy). Never in source, and never as a literal in endpoints.json.
- A remote endpoint is called only for a project whose policy lists it (ADR-0021).
  Tests use the `mock` protocol; they never call a real endpoint.
- A chat with a project gets tools bound to that project (ADR-0011). Any new tool that
  reads files or project data MUST be scoped in `server/tools/chat-tools.ts` `bindToProject`.
- Usage records hold counts and names, never prompt or answer text.
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
  middleware/     Security, rate limiting
src/              Frontend (React)
  components/     Chat, sidebar, workspace, UI primitives
  hooks/          State management
  lib/            API client, types
```

## Develop

```bash
npm run dev       # concurrent server + client
npm run build     # production build
npm start         # production server
```
