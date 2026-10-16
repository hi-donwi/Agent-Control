# Desk

The desk is Agent-Control's default UI: one screen that shows every client, project, and
agent in an Agent-Workspace as a 2D floor, and two drawers that hold everything else.
Wireframes: [wireframe.md](wireframe.md).

The classic chat UI stays reachable at `/?ui=classic` until the desk covers it.

## Why it lives here

Agent-Workspace's own web control (`ws web`, `ws_web.py`, `apps/workspace-control`) was
removed for a redesign. Agent-Control is the agent host of Agent-Workspace ADR-0019: it
already owns chat, approvals (ADR-0020), endpoint egress (ADR-0021), project-bound tools
(ADR-0011), coding sessions, and the loopback security envelope. The desk is that host's
UI, so it is built here and not in the framework. A desktop build later wraps the same
loopback server.

## Principles

1. **The floor is the home screen.** No sidebar, no tab bar. Two icons at the top right:
   the assistant and the menu.
2. **A pose never lies.** An avatar shows a specific activity only when an event says so.
   An agent known only to be active shows the generic `working` pose.
3. **Records are UIDL.** Every drawer section that lists records is a UIDL document
   rendered by `uidl-runtime` and read through one `DataAdapter`. The floor and the
   drawers themselves are React and SVG.
4. **Read first, write through `ws`.** The desk's endpoints are read-only and sandboxed to
   the workspace root. Writes to context, memory, notes, and tasks arrive as `ws`
   commands run through `execFile` (ADR-0019 §2), never as direct file writes.
5. **The operator sees everything; an agent sees one project.** The floor shows every
   registered project to the loopback operator. A chat opened from an agent is bound to
   that agent's project, with the same tool scoping and egress rules as before.

## Information architecture

| Surface | Opens from | Contents |
|---|---|---|
| Floor | Home | Zones (clients) > rooms (projects) > agents. Zoom to a client by its name. |
| Menu drawer | Menu icon | Workspace: Floor, Projects, Agents, Approvals. Project: Context, Memory, Runs, Tasks, Notes. System: Settings. |
| Assistant drawer | Assistant icon | Chat at workspace scope (local endpoints only, ADR-0021). |
| Agent drawer | An avatar | The agent card (state, detail, approvals) and a chat bound to its project. |

## Agent states

| State | Meaning | Source today | Pose |
|---|---|---|---|
| `idle` | Present, nothing happening | Open agent clock without a recent heartbeat; host agent between turns | Slow breathing |
| `working` | Active, activity unknown | Open agent clock with a heartbeat in the last two minutes | Pulsing dots under the desk |
| `thinking` | Waiting for the model | Host chat turn started, no output yet | Thought bubble |
| `reading` | Reading files or searching | Host tool calls `read_file`, `search_code`, `context_pack`, `list_projects`, `project_tree`, `git_diff` | Page in hand, eyes scan |
| `typing` | Writing an answer or a file | Host text stream; `write_file`, `edit_file` | Keyboard, hands tap |
| `running` | Running a command or a check | Host `run_command`, `diagnose_*`, `scan_security` | Terminal with a cursor |
| `learning` | Loading skills or routing | Host `get_skill`, `route_skills` | Open book, sparks |
| `waiting` | Needs a human | A pending approval for the project | Raised hand, badge on the menu icon |
| `warning` | Something failed | Host stream error | Amber mark |
| `offline` | Gone | Open clock older than the session cap | Grey, still |

External agents (Claude Code, opencode, Codex, Antigravity) appear through their
Agent-Workspace agent clocks: `context/works/.open-agent-*.json`, whose modification time
is the heartbeat `ws` touches on every call. Phase 2 lets them report finer activity
through `ws hooks`, so their poses become as precise as the host's own.

## API

All under `/api/agent/desk/`, behind the host's token and loopback checks.

| Endpoint | Returns |
|---|---|
| `GET floor` | `{ generatedAt, zones: [{ client, rooms: [{ key, group, description, agents, pendingApprovals, codingSession }] }], totals }` |
| `GET collections/:name?project=<key>` | `{ rows, total, page, pageSize }`, the shape of a UIDL `QueryResult` |

Collections: `projects`, `agents`, `approvals`, `memory`, `runs`, `tasks`, `notes`.
`memory`, `runs`, `tasks`, and `notes` require `project`. Every path is built from a
validated project key and checked to stay inside the workspace.

## Source layout

```
server/desk/
  registry.ts       registry.tsv by header name
  clocks.ts         open agent clocks and their heartbeat
  activity.ts       the host's own per-project activity, fed by the chat stream
  floor.ts          pure: registry + clocks + approvals + activity -> floor
  collections.ts    read-only drawer collections
src/desk/
  DeskApp.tsx       the shell: floor, two icons, drawers
  floor/            zones, rooms, avatars and their poses
  drawers/          drawer frame, menu, assistant, agent card
  uidl/             section documents and the DataAdapter
  desk.css          tokens and layout; light and dark
```

## Phases

| Phase | Theme | Deliverables |
|---|---|---|
| 1 | Skeleton | This document, the floor, both drawers, UIDL sections, polling every five seconds |
| 2 | Live floor | Server-sent events; activity events from `ws hooks` for external agents; persisted per-project chat history in the host's session log |
| 3 | Manage context | `ws note`, `ws task`, run edits through `ws`; UIDL forms and commands in the drawers |
| 4 | Agent work | Start a coding session from the agent drawer, review its diff, approve inline, verify with `ws verify`; Agent-Brain as an endpoint preset and MCP client |
| 5 | Desktop | A desktop shell around the same loopback server, OS keychain for credentials, a tray icon with the waiting count |
