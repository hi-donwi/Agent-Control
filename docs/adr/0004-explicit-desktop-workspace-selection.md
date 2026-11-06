# ADR-0004: Persist and apply an explicit desktop workspace

- Date: 2026-11-04
- Status: Accepted

## Context

The Node host resolves one workspace root at process startup. Finder does not provide a
reliable working directory, and the desktop shell previously did not set `WS_WORKSPACE_ROOT`.
Falling back to the packaged process directory can silently bind the desk to an unrelated
directory. The existing `~/.agent-control/config.json` contains provider credentials and
should not be rewritten by the native shell just to save a workspace path.

## Decision

The Tauri app owns an explicit, per-user workspace selection. It validates the canonical
folder by requiring `AGENTS.md` and `.agents/standards`, stores it in `workspace.json` under
Tauri's app config directory, and passes it to the Node host as `WS_WORKSPACE_ROOT`. When no
valid selection exists, the host does not start and the WebView presents onboarding. The
Settings drawer can change the root: the app starts and authenticates a replacement host,
persists the selection, swaps child processes, and reloads the WebView. In `AC_DESKTOP_MODE`,
the server fails closed rather than falling back when the explicit root is missing or
invalid. The native folder picker uses the Rust API from the official Tauri dialog plugin;
the WebView does not receive broad dialog-plugin permissions.

## Consequences

### Positive

- Finder-launched desktop startup is deterministic and cannot silently use an unrelated root.
- The selected path is validated by the native boundary and revalidated by the server.
- Desktop preferences remain separate from provider credentials.
- A workspace switch replaces the process whose services captured the old root at startup.

### Negative

- The first launch requires a workspace selection before the host can start.
- Changing workspaces restarts the local host and reloads the WebView.
- The official dialog plugin adds a native dependency chain (`tauri-plugin-dialog`,
  `tauri-plugin-fs`, and `rfd`) that must remain in the Cargo lockfile and audit scope.

### Neutral

- The browser-hosted server retains its existing root-discovery behavior.
- The selection identifies the Agent-Workspace root, not an individual project folder.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Infer the root from Finder's process working directory | Finder does not guarantee a useful current directory; this can select an unrelated location. |
| Reuse `~/.agent-control/config.json` | That file contains provider secrets; native workspace settings do not need to rewrite it. |
| Prompt for a folder on every app launch | Avoidable friction once a valid user selection is saved. |
| Use the dialog plugin's JavaScript API | It would expose an additional plugin IPC surface and require WebView permissions; the Rust API is sufficient. |
| Fall back to upward search in desktop mode | Fails the requirement that a packaged launch never silently chooses an unrelated root. |

## Sources

- [Tauri v2: Dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [tauri-plugin-dialog 2.8.4: FileDialogBuilder](https://docs.rs/tauri-plugin-dialog/2.8.4/tauri_plugin_dialog/struct.FileDialogBuilder.html)
- [tauri-plugin-dialog 2.8.4: FilePath](https://docs.rs/tauri-plugin-dialog/2.8.4/tauri_plugin_dialog/enum.FilePath.html)
- [Tauri 2.12.5: PathResolver](https://docs.rs/tauri/2.12.5/tauri/path/struct.PathResolver.html)
