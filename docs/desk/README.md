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
4. **Write through `ws`.** The desk reads workspace files directly, sandboxed to the
   workspace root, but every write is a `ws` command run through `execFile` with an
   argument array (ADR-0019 §2): notes through `ws note`, tasks through `ws task`, run plan
   rows through `ws plan status --operator`. A
   section's button names a host command; the host validates it and runs `ws`.
5. **The operator sees everything; an agent sees one project.** The floor shows every
   registered project to the loopback operator. A chat opened from an agent is bound to
   that agent's project, with the same tool scoping and egress rules as before.

## Information architecture

| Surface | Opens from | Contents |
|---|---|---|
| Floor | Home | Zones (clients) > rooms (projects) > agents. Zoom to a client by its name. |
| Project room | A room's name on the floor | One project: stage and focus, the mission board, crew, blockers, memory, and context (see Project room). Escape or the breadcrumb goes back to the floor. |
| Menu drawer | Menu icon | Workspace: Floor, Projects, Agents, Approvals. Project: Context, Memory, Runs, Tasks, Notes. System: Settings. |
| Assistant drawer | Assistant icon | Chat at workspace scope (local endpoints only, ADR-0021). |
| Agent drawer | An avatar | The agent card (state, detail, approvals), the coding session (start, stop, its changes), and a chat bound to its project. |

## Project room

A project's own page, opened from its name on the floor. It reads one endpoint,
`GET projects/:key`, and reloads when the project's room on the floor changes (at most every
two seconds) or after a change it made itself.

- **Mission board.** Work as it moves through an agent's day, not to-do / doing / done:
  *Queue* (waiting for its turn), *Ready for an agent* (clear enough to hand off), *In hands*
  (an agent is on it), *Awaiting review* (a person looks next), *Shipped*. Cards are operator
  tasks (`ws task`) and the plan steps of open runs (`ws plan`). A card moves by drag and
  drop or by its own "Move to" menu, which is also the keyboard path; a plan step has only
  pending, in progress, and done, so it stops at Queue, In hands, and Shipped. A blocked card
  raises its hand and says why. Blocking a task (`ws task block`) or a step, and dropping a
  step, asks for the reason first; a step's reason goes into its plan row's Notes through
  `ws plan status --operator --notes`. Unblock frees a task, and sets a step back to pending.
  A dropped step leaves the board.
- **Crew.** The agents in the room, in their live pose; one opens its drawer.
- **Blockers.** Everything that waits, from every source: pending approvals, blocked tasks,
  blocked plan steps, and the `Blocked on` table of `active.md`.
- **Memory.** Next up from `active.md`, the latest decisions and log milestones, and notes;
  "Add a note" opens the Notes section.
- **Context.** The files `ws context pack` loads for an agent bound here, and what the
  project's policy lets it reach: its autonomy default and allowed remote endpoints.

Each scope - the workspace, or one project - has its own conversation. The latest one is
loaded when the scope is first opened and every turn is written back, so a reload keeps it;
"New conversation" starts another and leaves the old one on disk (see History). "Earlier
conversations" lists the scope's conversations, newest first, titled by their first
question; opening one shows it, and the next turn is appended to it.

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
| `POST notes` | `{ project, title, body }` -> `{ path }`. Runs `ws note <project> <title> -` with the body on stdin; 400 with the reason on any refusal |
| `POST tasks` | `{ project, title, priority }` -> `{ id, status, revision }`. Runs `ws task add` |
| `POST tasks/status` | `{ project, id, status, revision }` -> `{ id, status, revision }`. Runs `ws task status --revision`; 409 when the task changed since the desk showed it |
| `POST tasks/block` | `{ project, id, reason, revision }` -> `{ id, status, revision }`. Runs `ws task block --revision`; a reason is required; 409 as above |
| `POST tasks/unblock` | `{ project, id, revision }` -> `{ id, status, revision }`. Runs `ws task unblock --revision`; 409 as above |
| `GET projects/:key` | The project room in one read: registry row, memory (`updated`, `stage`, `focus`, `nextUp`, `blockedOn`, the last six `decisions` and `log` entries, `notes`), `tasks` (operator tasks with `blocked` and `blockedReason`), `plans` (plan rows), open `runs`, `approvals`, the room's `agents`, `codingSession`, and `context` (`pack`, `policy`); 404 for an unknown or invalid key |
| `POST plan/status` | `{ project, run, n, status, revision, notes? }` -> `{ run, n, status, revision }`. Runs `ws plan status --operator`: the person at the desk must own the run, one row in progress, a reason for blocked or dropped; 409 when the plan changed since it was shown |
| `GET /api/agent/coding-sessions/:project/diff` | `{ session, diff, truncated }`: the session worktree's `git diff`, capped at 400 KB |
| `GET events` | Server-sent events: `floor` with the same body whenever something on it changes (checked every second), `ping` after fifteen quiet seconds. The desk reads it with fetch, so the token stays in a header. |
| `GET collections/:name?project=<key>` | `{ rows, total, page, pageSize }`, the shape of a UIDL `QueryResult` |

Chat history lives beside the chat API rather than under `desk/`:

| Endpoint | Returns |
|---|---|
| `POST /api/agent/chat` with `conversation: <uuid>` | The chat as before; the user message and the answer are appended to that conversation |
| `GET /api/agent/conversations/latest?scope=<key or _workspace>` | `{ id, messages }` of the scope's latest conversation, or `{ id: null, messages: [] }` |
| `GET /api/agent/conversations?scope=<key or _workspace>` | `{ conversations: [{ id, title, messages, updatedAt }] }`, newest first, at most 30 |
| `GET /api/agent/conversations/:id?scope=<key or _workspace>` | `{ id, messages }`; 404 when the conversation is not in that scope, so one project's history is never read from another's chat |

Collections: `projects`, `agents`, `approvals`, `memory`, `runs`, `tasks` (run plan
rows, each with its run id and the plan's revision), `backlog` (operator tasks, each with the revision `ws task status` checks), `notes`.
`memory`, `runs`, `tasks`, `backlog`, and `notes` require `project`. Every path is built from a
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
  project.ts        the project room in one read; active.md, decisions, and log parsers
  notes.ts, tasks.ts, plans.ts
                    writes, each through ws with stdin and a revision
src/desk/
  DeskApp.tsx       the shell: floor, two icons, drawers
  floor/            zones, rooms, avatars and their poses
  drawers/          drawer frame, menu, assistant, agent card
  room/             project room: mission board, stations, side panels
  uidl/             section documents and the DataAdapter
  desk.css          tokens and layout; light and dark
```

## Phases

| Phase | Theme | Deliverables |
|---|---|---|
| 1 | Skeleton (done) | This document, the floor, both drawers, UIDL sections |
| 2a | Live floor (done) | `GET events`; activity records from `ws hooks` and `ws agent activity` for outside agents; pose transitions; large zones span two columns |
| 2b | Chat history (done) | Per-scope conversations in the host's session log; the latest reloads with the page |
| 3a | Notes (done) | `ws note` in Agent-Workspace; the Notes section's form runs the host command `notes.add` |
| 3b | Tasks (done) | `ws task`; the Tasks section adds operator tasks and moves them with row actions, run plan rows stay read-only |
| 3c | Run plans (done) | Pending, Start, and Done on a plan row through `ws plan status --operator`; blocked and dropped, with a reason, from the mission board since 4c |
| 4a | Agent work (done) | Start and stop a coding session from the drawer; a Changes tab with the worktree's diff, reloaded after every turn; an approval or denial goes back into the conversation so the agent continues |
| 4b | Verify and hand back | `ws verify` against the session's worktree (it runs in the primary checkout today), then merge or discard the session's branch from the drawer |
| 4c | Project room (done) | One page per project: mission board over tasks and plan steps, block and unblock a task with a reason, crew, blockers from every source, memory, context pack and policy |
| 5 | Desktop | A Tauri v2 shell around the same loopback server, OS keychain for credentials, a tray icon with the waiting count |

## History

Conversations are the host's own state (Agent-Workspace ADR-0019 §2): one event log per
conversation at `<workspace>/.local/agent/sessions/<id>/events.jsonl`. The first line names
its scope; each later line is one message, with tool calls by name, status, and a result cut
to 2,000 characters as the transcript shows it. The rules:

- It holds conversation content, so it never leaves the machine: `.local/` is not
  committed or pushed, files are mode 0600, and usage records still carry no content
  (ADR-0021).
- A conversation never changes scope. A message sent with a conversation id that belongs
  to another scope is refused with 400, so one project's history cannot be replayed into
  another project's chat or to an endpoint only that one allows (ADR-0011, ADR-0021).
- Only the desk asks for history; the classic view sends no conversation id and keeps
  nothing.

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
