# Spec: Agent Brain-Routed Sessions

**Status:** In progress; owner decisions confirmed. Chat is Brain-only (see Progress); the Brain
API extensions are still required.

## Objective

Route Agent-Control's interactive assistant and specialist model inference through Agent
Brain. Agent Brain owns provider accounts, credential resolution, model catalogs, and routing
strategies so multiple accounts, providers, and configured local models can be combined.
Agent-Control must not silently send the same session directly to a provider when Brain is
unavailable.

## Confirmed ownership

- Brain owns provider/account credentials, account lifecycle, local-model configuration, and
  provider routing. Account and routing settings appear in Agent-Control's UI but are backed by
  Brain; Agent-Control never becomes their system of record.
- Brain supplies model inference. Agent-Control retains the conversation/tool loop, project-bound
  workspace tools, approvals, and worktree lifecycle. Brain does not receive shell or filesystem
  execution authority.
- The floor shows only Agent-Control sessions whose inference is Brain-backed. External CLI,
  editor, and other observed agent activity is excluded.
- Failover, round-robin, weighted selection, and provider/account selection are Brain behavior,
  not duplicated in Agent-Control.
- Agent Brain's repository may be adjusted for this integration. Existing uncommitted Brain
  changes must be preserved and their ownership clarified before overlapping files are edited.

## Existing contract and gaps (verified 2026-11-04)

When this spec was written, Agent-Control called Vercel AI SDK provider adapters directly for
chat; read-only specialists reuse the parent's model. Those adapters are now removed (see
Progress). Protocol-based endpoints and project egress allowlists
live in `<workspace>/.local/agent/endpoints.json` and project policy. The existing Brain CLI
integration supplies policy checks, instructions, and specialist definitions.

Agent Brain has a loopback gateway at `127.0.0.1:52140`. Its documented, authenticated
inference surface includes `POST /v1/chat/completions` with SSE/tool payload forwarding to
compatible provider accounts, plus Responses, Anthropic Messages, Gemini and embeddings routes.
`GET /v1/models` returns local roles/configured provider model IDs; `GET /v1/accounts` returns
redacted runtime account/cooldown metadata. The gateway accepts a bearer token, provider-qualified
model IDs, and `X-Brain-Account` selection. Account-scoped tokens cannot change account scope.
Brain retries eligible unpinned accounts once each within the selected provider and honors
cooldowns; pinned requests do not switch accounts. Provider or local fallback is not implicit.

Agent-Control can identify a configured remote OpenAI-compatible gateway with
`purpose: "agent-brain"` and a credential reference (for example,
`file:~/.brain/serve.token`) in the private endpoint configuration. Project-scoped provider
discovery calls `GET /v1/models` only after verifying that the project is registered and its
egress policy allows the Brain endpoint. Inference continues through the existing OpenAI
compatible streaming path, so tool execution remains host-side.

The account guide documents `brain accounts` CLI management and private credential storage
(`secrets/`, mode 0600 where supported); it explicitly says the gateway must restart after
configuration changes. There is no documented HTTP API for account CRUD, login/OAuth, model
refresh, or routing-profile administration. Current routing strategies are `priority` and
`round-robin` within a selected provider. There is no weighted strategy or explicit cross-provider
failover profile contract. The stable local-chat contract is text-only; structured tool requests
use compatible endpoint accounts. A Brain-side local tool-call path is therefore a prerequisite
for local models to participate in Agent-Control's tool loop.

The inspected Brain checkout has substantial uncommitted gateway/backend/config changes. They
are not treated as a stable API and must not be overwritten or assumed shipped.

**Recommendation:** Use Brain's OpenAI-compatible gateway for inference rather than inventing a
new stateful chat API. Keep conversation history and tool execution in Agent-Control; forward
each model step to Brain, stream tool calls back, execute only through the existing approval and
scope checks, then send tool results to Brain. Add a versioned Brain management/control surface
for the settings UI and routing profiles. Do not edit Brain's config files directly from
Agent-Control, and do not send provider keys through the chat/model path.

## Proposed behavior

1. A typed Brain inference adapter handles every interactive and specialist model-generation
   request. It supports SSE, tool calls/results, abort propagation, timeouts, and sanitized Brain
   errors. The client sends no provider credentials.
2. Brain remains stateless for inference in the initial integration: Agent-Control retains
   conversation IDs/history and sends the current context each turn. “Brain-only sessions” means
   all Agent-Control model responses are Brain-backed and only those sessions appear on the floor;
   it does not transfer the tool loop or conversation store to Brain.
3. Brain provides redacted model, account-health, and routing-profile metadata. The Agent-Control
   UI presents management controls backed by Brain. Provider secrets are handled only by a
   Brain-owned credential form/API, never returned to Agent-Control, persisted in its config,
   forwarded to a model, or written to logs/usage records. If the security boundary requires the
   literal secret not to enter Agent-Control frontend code, embed a Brain-origin credential form
   in the settings drawer; only redacted results cross the frame boundary.
4. Brain owns multi-account, multi-provider, configured local-model, failover, round-robin, and
   weighted routing. A versioned routing profile identifies compatible model/protocol targets,
   candidate accounts, strategy, weights, and eligible failover conditions. Agent-Control selects
   only a profile approved for the current project; it never chooses provider credentials.
5. Extend project egress policy to authorize Brain profile ID plus immutable revision, not merely
   the local Brain gateway URL. A profile revision's complete remote target set must be within the
   project's approved endpoints. Brain must reject a profile revision or target outside the
   authorization; changing a profile's targets creates a new revision requiring explicit policy
   approval. Local-only profiles cannot fail over to cloud. Failover may not widen the authorized
   endpoint set or locality.
6. Routing semantics: weighted/round-robin selection is deterministic under injected test
   randomness; priority is stable; each eligible candidate is attempted at most once per request.
   Cross-provider/local fallback is explicit per profile. Automatic retry/failover is allowed only
   before any response bytes/tool call are emitted; once streaming starts, terminate with a
   sanitized error rather than replaying a prompt and risking duplicate charges/tool execution.
   A pinned account/profile never switches outside its configured profile.
7. If Brain is unavailable, rejects the request, or has no eligible target, Agent-Control shows a
   recoverable error and never falls back to direct provider SDKs. Existing workspace tool
   scoping, worktree confinement, approvals, conversation scope, metadata-only usage records, and
   loopback-only host remain enforced by Agent-Control.
8. Remove external clock/activity-derived CLI/editor agents from the floor. Only host chat/coding
   sessions with Brain-backed inference may appear as agents; poses continue to derive from
   recorded host events, never guesses.

## Proposed Brain contract additions

These are proposed contracts, not existing routes:

- **Inference:** retain `POST /v1/chat/completions` as the initial wire contract; require a
  tested OpenAI-compatible tool-call loop for cloud and configured local backends. Pass request
  cancellation through to the selected backend. A per-session affinity mechanism is optional for
  the first slice; if enabled, Brain owns the binding and the caller supplies only an opaque
  session ID.
- **Read-only control plane:** versioned endpoints for provider capabilities, redacted accounts
  and model discovery, routing profile list/detail/revision, health/cooldown, and safe test/refresh
  operations. Do not expose credential references, bridge management keys, or raw secrets.
- **Management plane:** Brain-owned create/login/reauth/disable/remove/account-test and
  routing-profile CRUD operations, with OAuth begin/callback/status where supported. Mutations
  validate provider capabilities and update config atomically; gateway reload/restart is handled
  by Brain rather than Agent-Control. The management authority is distinct from inference
  credentials and is loopback-only, Host/Origin checked, authenticated, and CSRF-resistant.
- **Least privilege:** issue an Agent-Control inference credential scoped to approved profile
  IDs/revisions and protocols, not the Brain master token or raw provider credentials. Admin
  actions use a separate short-lived capability. Never put either token in a chat transcript,
  model tool schema, browser persistent storage, or usage record.
- **Settings UI:** Agent-Control can show profile/account metadata and status; credential entry and
  OAuth consent are Brain-owned. The UI must label that local file permissions are not encrypted
  credential storage and preserve Brain's existing `env:`/`file:` secret-reference options.

## Tech stack and commands

- React 19, Vite, TypeScript, Hono, Vercel AI SDK, and the existing loopback desktop host.
- `pnpm test`, `pnpm run build`, `pnpm run lint`, and the relevant Tauri/Rust checks.
- Provider/account/routing and Brain management API implementation/tests belong to the Agent
  Brain repository. Agent-Control tests the public integration contract against a deterministic
  mock gateway and mock management service.

## Project structure

- `server/`: add a Brain inference adapter; route assistant and specialists through it; expose
  authenticated, validated Brain profile/status APIs to the UI; retain existing tool execution.
- `server/egress.ts` and project policy: authorize Brain profile ID/revision and candidate target
  set before generation; never trust a browser-supplied provider/account destination.
- `server/desk/agents.ts`, `server/desk/index.ts`, and floor tests: stop merging external clocks
  and activity records into the floor; keep only Brain-backed host sessions.
- `src/desk/drawers/AssistantDrawer.tsx` and settings UI: use Brain-provided profiles; host or
  embed Brain-owned credential management so secrets do not enter Agent-Control app state.
- Agent Brain `internal/gateway/`, `internal/router/`, `internal/cli/`, and docs: add local tool
  protocol parity, explicit profile-based cross-provider/local routing, weights, and the secured
  management API. Do not modify these while overlapping uncommitted changes have unclear owners.
- `docs/adr/`: record the approved ownership, fallback, and profile-scoped egress decision.

## Code style

- Use a typed adapter and validated boundary schemas; keep provider-specific credentials and
  routing implementation out of Agent-Control.
- Stream responses through the existing SSE contract; map Brain errors to stable, sanitized
  application errors.
- Use structured process arguments if a CLI is used for a supported Brain operation; never
  interpolate prompts or model output into shell commands. Do not edit `accounts.yaml` or
  routing config directly from Agent-Control.

## Testing strategy

- Agent-Control mock-contract tests: streaming text and tool calls/results; cancellation;
  timeout; malformed and unavailable gateway; no SDK fallback; project conversation/worktree/tool
  scope preserved; external clock/activity sources absent from floor responses.
- Egress/security tests prove profile revision and every fallback target are authorized for the
  selected project; local-only never reaches cloud; changing profile targets invalidates stale
  approval; secrets and prompt/completion content do not enter logs or usage records.
- Brain tests: redacted account/profile metadata; management auth/CSRF/Host validation; atomic
  mutation and reload; compatible local tool calls; account isolation; explicit cross-provider
  failover; no repeated target; deterministic round-robin and weighted selection; no retry after
  response bytes; no unauthorized profile widening.
- Build and lint the React/TypeScript client; keep the existing Tauri build and loopback/auth
  tests green.

## Boundaries

- **Always:** Brain owns provider credentials/routing; Agent-Control owns host tools/approvals;
  the floor excludes external CLI/editor sessions; filter routes by project-authorized Brain
  profile revision; fail closed; preserve workspace scoping; use mock Brain/provider responses.
- **Ask first:** overwriting or incorporating the existing uncommitted Agent Brain changes,
  changing who executes tools, widening a project's remote egress, or adding third-party
  dependencies.
- **Never:** persist or return provider keys from Agent-Control; put keys in its logs, chat,
  config, or usage records; silently fall back to a direct provider; let failover widen the
  authorized target set; log prompts/completions; send approvals or tool execution to Brain.

## Success criteria

- Every Agent-Control inference path uses the Brain gateway, including streaming, tool loops,
  cancellation, and specialists; direct provider adapters are removed from active chat paths and
  no fallback remains.
- The settings UI shows Brain-backed account/profile metadata and delegates credential/OAuth
  entry to Brain; Agent-Control never receives a credential value or provider secret reference.
- Brain supports multiple account/provider/local targets, explicit failover, round-robin, and
  weighted profiles with contract tests and redacted metadata.
- Negative tests prove project egress cannot be bypassed by account selection, profile edits,
  retries, or cross-provider/local failover.
- Floor responses contain no external CLI/editor/agent-clock entries and show only Brain-backed
  Agent-Control sessions.
- Existing workspace tools, approvals, coding worktree lifecycle, loopback boundary, and
  metadata-only usage invariants remain green.

## Remaining decisions / blockers

1. The Brain gateway covers inference but is not a stateful session API. This spec recommends
   keeping conversation history and tool orchestration in Agent-Control; confirm if the word
   “session” requires Brain-side conversation persistence instead.
2. Choose the management surface: Brain-hosted embedded settings form (recommended to keep
   provider secrets out of Agent-Control frontend/server) versus a direct browser call to Brain's
   authenticated management API. In either case, secrets are never proxied through Agent-Control
   backend or returned to its UI state.
3. Resolved 2026-11-06: the uncommitted Brain gateway/backend/config changes were verified and
   landed on Brain's main. The account management API and routing-profile contract are still new
   work.
4. The Brain gateway's auth currently supports master/account-scoped tokens, not profile/revision
   scoped client credentials. Add a least-privilege Agent-Control credential before enabling
   cross-provider profiles.

## Progress

- **2026-11-06, Brain-only chat.** The direct OpenAI, Anthropic, and Gemini adapters, the
  `/api/agent/config` key API, and the settings key dialog are removed. Chat accepts only an
  endpoint with `purpose: "agent-brain"` or the offline `mock` (`isChatEndpoint()` in
  `server/chat-model.ts`); `/api/agent/providers` lists only those. Provider keys left in
  `~/.agent-control/config.json` are ignored and named, never printed, at startup. The
  auto-discovered `lokal` gateway is a remote Agent Brain endpoint, so it needs the project's
  policy like any other Brain endpoint. `server/chat.e2e.test.ts` proves that a non-Brain
  endpoint and a legacy provider are refused before any request, and that a Brain that is down
  never reaches a direct endpoint. Behavior 7 and the first half of success criterion 1 hold;
  specialists already reuse the parent's Brain model.
- **Still open:** Brain-backed account/profile settings (behavior 3, success criterion 2),
  profile-scoped egress (behavior 5), the least-privilege inference credential (blocker 4), and
  local tool-call parity in Brain.
