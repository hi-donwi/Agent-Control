# Agent-Control

A standalone AI-powered workspace assistant. This is a product repo — it does
not modify the Agent-Workspace framework.

## Stack

React 19 + Vite + TypeScript frontend, Hono + Vercel AI SDK backend.
Multi-provider: OpenAI, Anthropic, Google Gemini. Streaming SSE chat with
markdown rendering and syntax highlighting.

## Rules

- Server MUST bind to 127.0.0.1 only. Never 0.0.0.0.
- API keys MUST live in `~/.agent-control/config.json`, never in source.
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
