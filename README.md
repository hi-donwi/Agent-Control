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
