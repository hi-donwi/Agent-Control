# ADR-0002: Desktop host bootstrap and authentication

- Date: 2026-11-03
- Status: Accepted

## Context

The Tauri webview must call the existing Agent-Control host without putting its process
token in a URL, command-line argument, persistent browser storage, or log. Browser-host
startup and its existing sign-in link must continue to work. A desktop process can bind an
ephemeral loopback port, so the frontend needs an authenticated readiness handoff before
rendering API-backed UI.

## Decision

The desktop host binds only to `127.0.0.1` on an OS-assigned port. Once listening, it writes
one newline-terminated JSON readiness message to stdout using protocol version 1; the
message contains only the fixed loopback host, port, and random process token. Rust bounds
the line size and validates the message type, version, host, port, and token before exposing
it to the `main` Tauri window through the `desktop_bootstrap` command. That command refuses
other origins and windows.

The frontend keeps the endpoint and token in memory and sends the token in the `Authorization`
bearer header. Desktop API requests require an exact trusted webview origin and do not accept
query-token authentication. The existing browser mode continues to accept its current query
token and bearer flows. Desktop CORS is limited to the app origin and the fixed Vite dev
origin, with no credentialed CORS.

Development starts the checked-out TypeScript host through the local Node runtime. Release
startup expects a bundled `agent-control-host` resource; producing, signing, and distributing
that binary is a separate packaging task. macOS is the first development target; the minimum
supported macOS version remains open until release planning.

## Alternatives

- Put the token in a query string or browser URL: URLs are copied into history, diagnostics,
  and other browser surfaces; rejected for the desktop flow.
- Put the token in process arguments or environment variables: process inspection and crash
  reporting can expose them; rejected in favor of the private stdout pipe.
- Allow any loopback origin or wildcard CORS: another local page could use the host; rejected
  in favor of an exact app origin and bearer authentication.
- Remove query-token authentication globally: would break existing browser-host startup;
  retained only outside desktop mode.

## Consequences

The desktop frontend cannot render API-backed UI until native bootstrap completes. A host
restart invalidates the in-memory token and requires an app restart. The release sidecar
artifact and macOS deployment target still need to be established before a distributable
desktop build is complete.

## Sources

- [Tauri v2: Embedding external binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2: Embedding additional resources](https://v2.tauri.app/develop/resources/)
- [Tauri v2: Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)
