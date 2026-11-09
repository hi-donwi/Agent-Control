# macOS desktop host packaging

The Tauri app bundles a standalone Node.js host executable as the `agent-control-host`
resource. The executable contains the Node runtime and bundled server dependencies; it does
not include the workspace, workspace CLI, external system tools, provider credentials, or
user configuration.

This is the Agent-Control application package, not yet the complete Agent Workspace Suite
installer. The component boundary, readiness contract, and future signed suite manifest are
documented in [suite-architecture.md](suite-architecture.md).

## Build and verify

Use macOS and one of the Node versions allowed by `package.json` (22.23.4+, 24.22.1+, or
26.12.1+ within the declared major ranges):

```sh
pnpm run desktop:host:build
pnpm run desktop:host:smoke
CI=true pnpm run desktop:build
pnpm run desktop:host:bundle-smoke
```

For an app-only check without creating a DMG, use:

```sh
pnpm exec tauri build --bundles app
pnpm run desktop:host:bundle-smoke
```

The executable and intermediate SEA files are generated under the ignored
`src-tauri/target/desktop-host/` directory. Tauri copies the executable into
`Agent Control.app/Contents/Resources/agent-control-host`, the path resolved by the Rust
bootstrap. Cross-architecture builds are rejected; build the host with Node matching the
Tauri target architecture.

Node 22 and 24 use the documented SEA preparation-blob and `postject` injection process.
Node 26 uses Node's `--build-sea` command. Both bundle the server as CommonJS and disable
SEA code caching. The build signs the host with an ad-hoc signature as required for local
macOS execution; this is not release signing or notarization.

`pnpm run desktop:build` requests all Tauri bundle targets, including a DMG. `CI=true` makes
Tauri pass `--skip-jenkins` to its DMG script, skipping Finder's cosmetic AppleScript setup.
On this macOS builder, that avoids a busy temporary image and produces a valid DMG; its
Finder window uses the default layout. The app-only command is useful for validating the
`.app` resource without invoking DMG creation.

## Workspace selection

On first launch, the app asks the user to choose the Agent-Workspace folder containing
`AGENTS.md` and `.agents/standards`. The canonical path is stored in
`app_config_dir()/workspace.json`, separate from provider settings and secrets. The Settings
drawer shows the active root and allows it to be changed. A change starts and authenticates a
replacement host before saving the new root and stopping the previous host; the WebView then
reloads with the new host token.

Tauri always sets `WS_WORKSPACE_ROOT` explicitly for its host. In desktop mode,
`findWorkspaceRoot()` fails closed if that path is absent or lacks the expected markers; it
does not fall back to the packaged app's working directory. When no valid root is saved, the
host is not started and the onboarding screen remains available. The standalone browser
server keeps its existing root-discovery behavior. Smoke/e2e fixtures create the workspace
markers and pass the root explicitly.

## Release boundary

Node SEA is documented as active development. This workflow has been verified on macOS
arm64 only. Minimum macOS version, Intel support, release signing, and notarization remain
undecided; generated artifacts are not release-ready until those decisions and validations
are complete.

## Sources

- [Node.js v22.23.4: Single executable applications](https://nodejs.org/download/release/v22.23.4/docs/api/single-executable-applications.html)
- [Node.js v24.22.1: Single executable applications](https://nodejs.org/download/release/v24.22.1/docs/api/single-executable-applications.html)
- [Node.js v26.12.1: Single executable applications](https://nodejs.org/download/release/v26.12.1/docs/api/single-executable-applications.html)
- [Tauri v2: Embedding additional files](https://v2.tauri.app/develop/resources/)
- [Tauri v2: Environment variables](https://v2.tauri.app/reference/environment-variables/)
- [Tauri v2: Dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri 2.12.5: PathResolver](https://docs.rs/tauri/2.12.5/tauri/path/struct.PathResolver.html)
