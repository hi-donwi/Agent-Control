# ADR-0003: Package the desktop host as a Node SEA resource

- Date: 2026-11-03
- Status: Accepted for development packaging; release qualification is open

## Context

The Tauri release bootstrap already starts an `agent-control-host` file from the app's
resource directory and reads its private readiness message from stdout. Development starts
the checked-out TypeScript server with Node, but a packaged app must not require a separately
installed Node runtime or load server dependencies from the repository.

The project permits Node 22, 24, and 26. The SEA workflow differs between those supported
lines, and Node documents SEA as active development. macOS is the first packaging target;
the current build machine is Apple Silicon.

## Decision

Build the server into one CommonJS bundle with esbuild, then make a Node Single Executable
Application from the exact Node executable running the build. Node 22/24 use
`--experimental-sea-config` plus `postject`; Node 26 uses `--build-sea`. The build disables
code caching and ignores `NODE_OPTIONS` when the resulting SEA runs.

Tauri bundles the generated executable through `bundle.resources`, mapping it to the
resource name `agent-control-host`. This matches the Rust bootstrap's existing resource
resolution and preserves the stdout readiness protocol without introducing a second process
API.

The build ad-hoc signs the macOS executable where the Node SEA process requires a signature
after injection. This is only a local build requirement; it does not decide release signing
or notarization. Only the current macOS arm64 path is verified. Minimum macOS version and
Intel support remain open.

## Alternatives considered

- **Run the source with an installed Node:** rejected for packaged builds because it adds a
  separate runtime and dependency installation requirement.
- **Tauri `externalBin` sidecar integration:** not selected because the existing Rust
  bootstrap needs the executable's stdout readiness line and already resolves a resource
  path directly; `bundle.resources` is the smaller integration.
- **Use only Node 26 `--build-sea`:** rejected because the project also supports Node 22 and
  24. The build branches by Node major version instead.

## Consequences

- The packaged host does not need Node installed and its JavaScript dependency graph is
  bundled into the executable.
- Building requires macOS, a project-supported Node version, and `postject` for Node 22/24.
- The host still expects a configured Agent-Workspace and its local tools; this is not a
  self-contained workspace distribution.
- SEA remains an active-development Node feature. These artifacts are development packaging,
  not a qualified release, until OS support, signing, notarization, and architecture policy
  are decided and tested.

## Sources

- [Node.js v22.23.4: Single executable applications](https://nodejs.org/download/release/v22.23.4/docs/api/single-executable-applications.html)
- [Node.js v24.22.1: Single executable applications](https://nodejs.org/download/release/v24.22.1/docs/api/single-executable-applications.html)
- [Node.js v26.12.1: Single executable applications](https://nodejs.org/download/release/v26.12.1/docs/api/single-executable-applications.html)
- [Tauri v2: Embedding additional files](https://v2.tauri.app/develop/resources/)
- [Tauri v2: Embedding external binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2: Environment variables](https://v2.tauri.app/reference/environment-variables/)
