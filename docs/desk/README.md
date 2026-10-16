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
| `waiting` | Needs a human | A pending approval for the project; an outside agent's permission prompt or idle-input notice | Raised hand, badge on the menu icon |
| `warning` | Something failed | Host stream error | Amber mark |
| `offline` | Gone | Open clock older than the session cap | Grey, still |

Agents outside this host (Claude Code, opencode, Codex, Antigravity) appear through two
Agent-Workspace records:

- their open agent clock, `context/works/.open-agent-*.json`, whose modification time is a
  heartbeat: presence only (`working`, `idle`, `offline`);
- their activity record, `.local/agent/activity/<session>.json`, written by the Claude Code
  hooks `ws hooks install` adds, or by `ws agent activity <state>` from any other agent:
  the same states as the host, with a tool name as the detail.

A record speaks for ten minutes; after that the clock speaks again (`server/desk/agents.ts`).
A raised hand is the exception: it stays up until the agent reports again or its session
passes the cap, because a person who stepped away must still find it.

## API

All under `/api/agent/desk/`, behind the host's token and loopback checks.

| Endpoint | Returns |
|---|---|
| `GET floor` | `{ generatedAt, zones: [{ client, rooms: [{ key, group, description, agents, pendingApprovals, codingSession }] }], totals }` |
| `GET events` | Server-sent events: `floor` with the same body whenever something on it changes (checked every second), `ping` after fifteen quiet seconds. The desk reads it with fetch, so the token stays in a header. |
| `GET collections/:name?project=<key>` | `{ rows, total, page, pageSize }`, the shape of a UIDL `QueryResult` |

Collections: `projects`, `agents`, `approvals`, `memory`, `runs`, `tasks`, `notes`.
`memory`, `runs`, `tasks`, and `notes` require `project`. Every path is built from a
validated project key and checked to stay inside the workspace.

## Source layout

```
server/desk/
  registry.ts       registry.tsv by header name
  clocks.ts         open agent clocks and their heartbeat
  activity-files.ts outside agents' activity records
  agents.ts         pure: clocks + activity records -> outside agents
  activity.ts       the host's own per-project activity, fed by the chat stream
  floor.ts          pure: registry + agents + approvals + host activity -> floor
  stream.ts         the floor as events, sent only on change
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
| 1 | Skeleton (done) | This document, the floor, both drawers, UIDL sections |
| 2a | Live floor (done) | `GET events`; activity records from `ws hooks` and `ws agent activity` for outside agents; pose transitions; large zones span two columns |
| 2b | Chat history | Per-project conversations persisted in the host's session log, so an agent drawer shows its history after a reload |
| 3 | Manage context | In this order: notes (`ws note`), tasks (`ws task`, status changes first), run plans; UIDL forms and commands in the drawers, every write through `ws` |
| 4 | Agent work | Start a coding session from the agent drawer, review its diff, approve inline, verify with `ws verify`; Agent-Brain as an endpoint preset and MCP client |
| 5 | Desktop | A Tauri v2 shell around the same loopback server, OS keychain for credentials, a tray icon with the waiting count |

## Wireframe review decisions (2026-10-16)

The wireframe was approved with three questions open; the answers:

1. **Zone width follows size, not activity.** A zone with five or more rooms spans two
   columns on a wide screen. Width that grew with activity would move the layout every
   time an agent woke up; activity already shows as poses, wall color, and the caption.
2. **Editing comes in the order notes, tasks, run plans.** Notes are a new folder with no
   format to break and the most daily use. Tasks start with status changes only. Run
   plans are Markdown tables other agents edit by hand, so they come last and only
   through `ws`, with a revision check.
3. **An outside agent's drawer shows its activity and its project's runs; the chat there
   is Agent Control's.** The desk cannot send a message into a Claude Code or opencode
   session - they are separate processes with no inbound API - and pretending otherwise
   would lose messages. The drawer says so plainly.

## Desktop

The desktop app is a Tauri v2 shell, chosen over Electron for its size and memory on small
machines. It changes no UI code: the shell starts the host as a sidecar binary (the Node
server compiled to a single executable), waits for its loopback port, and opens the desk in
its webview with the token the host prints. The browser rules stay as they are - loopback
only, `Host` and `Origin` checks, no cross-origin access - so the web and desktop builds
share one security envelope. The cost is a Rust toolchain for whoever builds the desktop
app; the web build does not need it.
