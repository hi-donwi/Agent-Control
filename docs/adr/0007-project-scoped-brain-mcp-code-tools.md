# ADR-0007: Project-scoped Agent Brain MCP code tools

- **Date:** 2026-11-11
- **Status:** Accepted
- **Deciders:** Project maintainer

## Context

Agent Brain's stdio MCP already offers repo-map, symbol lookup, code search, project-command
metadata, plus unrelated knowledge, skill, model, and host tools. Agent-Control currently owns
its own workspace tools and does not call Brain MCP. Exposing Brain's whole MCP server to an
unscoped chat would cross project boundaries; accepting a root from model/browser input would
turn read-only tools into arbitrary host filesystem access.

## Decision

For a project-bound chat routed through an endpoint marked `purpose: agent-brain`, Agent-Control
may start a temporary Brain stdio MCP client for the trusted project folder or current coding
worktree. The root is derived from `ChatScope`, validated under the selected workspace's
registered project or `.local/worktrees/<project>` boundary, and passed as a fixed CLI argument
to `brain mcp --root <root>`. The model cannot change that root.

Only `repo_map`, `find_symbol`, `search_code`, and `project_commands` are bridged as prefixed
`brain_*` tools. The host strips path/root overrides, caps argument/result size and duration,
filters MCP tool names against a fixed allowlist, and closes the MCP client/process when the chat
stream completes, errors, or is cancelled. MCP results are untrusted repository data. Existing
Agent-Control tool policy and Brain endpoint egress policy remain in force.

The official TypeScript MCP client SDK uses stdio with `shell: false`; Agent-Control supplies only
fixed `mcp --root <trusted-root>` arguments. The command defaults to `brain` on PATH or may be
operator-configured via `AGENT_BRAIN_BINARY`. The SDK safe environment is inherited, plus only
Brain's `LOKAL_HOME` override when configured. A four-session concurrency cap bounds child
processes.

Skills, global knowledge search, provider/account administration, generic MCP invocation, and
tool-process management are not bridged to chat. Unbound chats receive no Brain MCP tools. A
missing local Brain CLI degrades to existing Agent-Control tools rather than failing inference.

## Consequences

### Positive

- Agent-Control project chats can use Brain's code-intelligence implementations without
  duplicating indexes/parsers.
- MCP stays stdio/local and is scoped to the selected project/worktree root.
- Unrelated Brain MCP tools do not become available to a model through a broad generic bridge.

### Negative

- The local `brain` executable must be on `PATH` or configured by `AGENT_BRAIN_BINARY`.
- A short-lived MCP subprocess is created for a project-bound Brain chat; a process cap and
  deterministic cleanup are required.
- The local Brain MCP tools operate under the filesystem permissions of the Agent-Control host;
  this is a local trusted integration, not a remote API.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Expose a generic `mcp_call(tool, args)` tool | Lets the model reach unrelated Brain tools and bypass their UI/project policy boundary. |
| Add Brain `/manage/v1/code` with browser paths | Management page is unscoped and can read any root unless duplicated project authorization is built. |
| Copy repo-map/symbol implementation into Agent-Control | Duplicates Brain's existing code-index behavior and drifts from MCP tool contracts. |
| Launch MCP for unbound chats | No project root exists, so reads cannot be safely scoped. |

## Follow-up

- [x] Add E2E coverage with a fake Brain MCP stdio server and prove session close terminates the child process.
- [ ] If adding more Brain MCP tools, require a code review of each tool's root and side-effect semantics.
- [ ] Keep browser management and chat MCP integration separate; do not allow management credentials in the MCP client.
