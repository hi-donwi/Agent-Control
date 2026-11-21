# ADR-0002: Desktop host bootstrap and authentication

- Date: 2026-11-03
- Status: Accepted

## Context

The Tauri webview must call the existing Agent-Control host without putting its process
token in a URL, command-line argument, persistent browser storage, or log. The standalone
browser host also needs an explicit sign-in exchange that does not expose its token in
HTML or a URL. A desktop process can bind an ephemeral loopback port, so the frontend needs
an authenticated readiness handoff before rendering API-backed UI.

## Decision

The desktop host binds only to `127.0.0.1` on an OS-assigned port. Once listening, it writes
one newline-terminated JSON readiness message to stdout using protocol version 1; the
message contains only the fixed loopback host, port, and random process token. Rust bounds
the line size and validates the message type, version, host, port, and token before exposing
it to the `main` Tauri window through the `desktop_bootstrap` command. That command refuses
other origins and windows.

The frontend keeps the endpoint and token in memory and sends the token in the `Authorization`
bearer header. Desktop API requests require an exact trusted webview origin and do not accept
query-token authentication. The standalone browser host also binds only to `127.0.0.1`.
It generates its process token in memory, serves it only from `GET /auth` after checking
that the peer address is loopback, and sends it with `Cache-Control: no-store`. Its static
HTML never contains the token, the startup URL is token-free, and API requests require an
exact same-origin match or the fixed local Vite dev origin. Query-token authentication is
disabled in every mode. Desktop CORS is limited to the exact Tauri webview origins
(`tauri://localhost` on macOS/Linux and `http://tauri.localhost` on Windows with the default
scheme) and the fixed Vite dev origin, with no credentialed CORS. Configured Brain endpoint
origins are used by the desktop `frame-src` policy, not by Desk API CORS; the desktop token
continues to arrive through the validated native bootstrap command.

Development starts the checked-out TypeScript host through the local Node runtime. Release
startup expects a bundled `agent-control-host` resource; producing, signing, and distributing
that binary is a separate packaging task. macOS is the first development target; the minimum
supported macOS version remains open until release planning.

## Alternatives

- Put the token in a query string, browser URL, or HTML: these surfaces can be copied into
  history, diagnostics, caches, and page content; rejected for both browser and desktop
  flows.
- Put the token in process arguments or environment variables: process inspection and crash
  reporting can expose them; rejected in favor of the private stdout pipe.
- Allow any loopback origin or wildcard CORS: another local page could use the host; rejected
  in favor of an exact app origin and bearer authentication.
- Remove query-token authentication globally: would break existing browser-host startup;
  retained only outside desktop mode.

## Consequences

The desktop frontend cannot render API-backed UI until native bootstrap completes. The
standalone browser frontend cannot render API-backed UI until its loopback `/auth` exchange
completes. Both keep the token in memory; a page reload performs a fresh standalone exchange.
A desktop host restart invalidates the in-memory token and requires an app restart. The
release sidecar artifact and macOS deployment target still need to be established before a
distributable desktop build is complete.

## Sources

- [Tauri v2: Embedding external binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2: Embedding additional resources](https://v2.tauri.app/develop/resources/)
- [Tauri v2: Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)
