# ADR-0005: Authorize Agent Brain profile revisions for project egress

- **Date:** 2026-11-08
- **Status:** Accepted
- **Deciders:** Project maintainer through the Agent-Brain integration contract
- **Project:** Agent-Control

## Context

Agent-Control already denies remote endpoints unless a project's operator policy names
the endpoint. For Agent Brain, endpoint-only approval is too broad: Brain can route to
multiple providers and accounts behind one URL. The host must bind each Brain request to
the exact profile revision approved for that project's context.

## Decision

We require every configured Agent-Brain endpoint to declare one `routingProfile` with an
ID and content-addressed revision. The project's operator policy must list the same
endpoint, profile ID, and revision under `llm.brain_profiles`; an absent, malformed, or
mismatched entry denies egress. Agent-Control sends the configured profile ID and revision
as Brain headers for both model discovery and inference. The browser cannot select or
override either value. The Brain credential remains a private `env:`, `keychain:`, or
`file:` reference and must be scoped to that profile revision and `openai-chat` protocol.
Profile changes require endpoint configuration and operator policy approval to be updated
together.

## Consequences

### Positive
- Project egress approval includes Brain's effective target set, not only its gateway URL.
- A stale profile revision fails closed before inference.
- Browser input cannot widen the project's approved destination set.

### Negative
- Operators must update endpoint config and each authorized project's policy after a
  profile revision changes.
- Existing Brain endpoint configurations using the master token must be migrated to a
  scoped profile credential.

### Neutral
- Generic non-Brain endpoint allowlisting remains unchanged.
- `mock` remains offline and requires no Brain profile.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Approve only the Brain endpoint name | Does not express or constrain the provider/account targets reachable behind Brain. |
| Let the browser choose a profile | Browser-controlled routing could bypass project policy. |
| Trust endpoint configuration without project policy | The endpoint is shared across projects with different egress permissions. |

## Follow-up

- [x] Define endpoint and operator-policy fields.
- [x] Add strict parsing and fail-closed egress tests.
- [x] Add Brain headers to inference and model discovery.
- [x] Document migration from the master token to a scoped credential.
