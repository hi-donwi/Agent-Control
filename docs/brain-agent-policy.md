# Brain policy at coding-tool dispatch

Agent Control remains the tool executor. Brain's read-only `agent check` command can
add an operator-selected policy to `run_command`, `write_file`, and `edit_file`.

The operator opts a project in by creating
`<workspace>/.local/agent/brain-policies/<project>.yaml` outside product repositories.
Use a Brain build providing `agent check`; `AGENT_BRAIN_BINARY` selects its executable.
Nothing in a model's tool arguments can select an executable or a policy file.

```yaml
default: ask
rules:
  - tool: write
    path: "private/**"
    decision: deny
```

Brain allow never overrides the existing workspace policy. Brain ask requires the
existing single-use approval flow even when the workspace permits automatic execution.
Brain deny, missing executable, malformed output, timeout and invalid policy all prevent
execution. Projects without this optional policy retain their existing behavior.

Approval hashes include both policies and the worktree. Every dispatch evaluates Brain,
and policy snapshots are rechecked before execution. A changed policy invalidates the
request instead of silently using its old decision. These checks complement filesystem
isolation; neither shell-prefix policies nor approval hashes are an operating-system
sandbox.

This integration currently gates coding mutations; task-record mutations retain their
existing workspace gate. Read-only subagent execution is described below when enabled.

## Bounded read-only specialists

For opted-in project chats the host exposes `project_instructions`, `list_subagents`
and `run_subagent`. Definitions are loaded from the active project's or worktree's
`.brain/agents` directory through Brain, including its symlink confinement checks.
Invalid registries fail closed. The project instruction tool returns Brain's rendered
guidance, which explicitly grants no tool permissions.

Children always reuse the parent's model and egress-approved endpoint. Role model
preferences cannot switch endpoints. Each child has a separate prompt, no conversation
history from other projects, and only the intersection of the role's tool list with
`read_file` and `search_code`. Every child read requires Brain allow under the role's
effective policy and must stay inside the project; ask is returned to the parent as a
refusal, not automatically approved. Children receive no delegation, shell, or mutation
tools. Definitions requesting those tools are intentionally narrowed.

Starting a child goes through both policies and the existing approval flow. The approval
input hash includes the role definition, task and role name. Host bounds are two concurrent
children globally, five model steps (or the role's smaller limit), twelve read/search calls,
30 seconds, 2048 output tokens per model step and a 16 KiB returned summary. Request
cancellation propagates to the model call. Completed child token usage is recorded separately
through the parent's normal metadata-only usage writer. No prompt text enters usage logs.

Example role at `.brain/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Review source and identify missing tests
tools: [read, search]
max_turns: 3
---
Read the relevant files and return findings with paths. Do not modify files.
```

For read-only child operation an operator policy can allow `read` and `search` while
leaving `subagent` at ask. The workspace policy must also permit or approve `run_subagent`.
This increment does not provide child write access, recursive delegation, a background job
queue, or persistent resume after a process restart.
