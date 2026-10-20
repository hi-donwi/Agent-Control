# ADR-0001: Brain policies with host-owned bounded specialists

- Date: 2026-10-20
- Status: Accepted

## Context

Brain defines project instructions, permission decisions and subagent roles. The coding
host already owns project isolation, worktree mutation, operator approvals and model
routing. Executing Brain-defined roles must preserve those boundaries.

## Decision

Opt in per project using an operator-owned Brain policy outside repositories. Use a fixed
CLI argument vector to query Brain; the model cannot select policies or executables.
Brain can tighten host decisions but never widen them. Bind approvals to both policies,
the active worktree and the exact child definition/task. Recheck policy snapshots before
execution and fail closed on invalid responses or a missing required Brain executable.

The host runs first-stage specialists read-only. Children reuse the parent's model and
endpoint, get only allowed project reads/searches, cannot spawn children, and have explicit
concurrency, step, tool-call, output and time limits. Child usage is recorded through the
host's existing metadata-only writer. Brain itself remains a read-only contract provider.

## Alternatives

- Execute tools inside Brain: duplicates the host's approval and worktree infrastructure.
- Allow role-specific endpoints: could bypass the project's existing egress decision.
- Enable child shell/write access immediately: requires a broader execution and recovery
  contract; defer until the read-only lifecycle is established.
- Replace host policy with Brain allow: would loosen existing operator protections.

## Consequences

Existing projects behave as before until opted in. A compatible Brain build is required.
Read-only children cannot implement code changes themselves; the parent performs approved
mutations. Persistent job resume and background scheduling remain outside this increment.
