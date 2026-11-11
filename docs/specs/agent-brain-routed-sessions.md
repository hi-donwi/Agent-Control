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

Agent-Control identifies a configured remote OpenAI-compatible gateway with
`purpose: "agent-brain"`, a scoped credential reference, and a `routingProfile` ID/revision
in private endpoint configuration. Project-scoped provider discovery calls `GET /v1/models`
only after verifying that the project is registered and both the Brain endpoint and exact
profile revision are allowed by egress policy. Agent-Control sends the configured profile
headers for discovery and inference; the browser cannot override them. Inference continues
through the existing OpenAI-compatible streaming path, so tool execution remains host-side.

The account guide documents `brain accounts` CLI management and private credential storage
(`secrets/`, mode 0600 where supported); it explicitly says the gateway must restart after
configuration changes. Brain now exposes a typed `/manage/v1/` API for redacted account
management, provider checks/model discovery, supported OAuth sessions, and routing-profile
administration. Current routing strategies are `priority` and
`round-robin` within a selected provider. There is no weighted strategy or explicit cross-provider
failover profile contract. The stable local-chat contract is text-only; structured tool requests
use compatible endpoint accounts. A Brain-side local tool-call path is therefore a prerequisite
for local models to participate in Agent-Control's tool loop.

The profile credential contract is defined by Agent-Brain ADR-0014 and Agent-Control ADR-0005.
Issue a credential on the Brain host with `brain router credential <profile-id> --protocol chat`;
it writes an owner-only token file and a non-secret profile manifest. Never use `serve.token`
as Agent-Control's inference credential. The token is scoped to one current profile revision
and selected protocol set; changing the profile or rotating the master token invalidates it.

**Recommendation:** Use Brain's OpenAI-compatible gateway for inference rather than inventing a
new stateful chat API. Keep conversation history and tool execution in Agent-Control; forward
each model step to Brain, stream tool calls back, execute only through the existing approval and
scope checks, then send tool results to Brain. Add a versioned Brain management/control surface
for the settings UI and routing profiles. Do not edit Brain's config files directly from
Agent-Control, and do not send provider keys through the chat/model path.

## Proposed behavior

### Agent-Control project-bound Brain MCP client

When a project chat routes to an Agent Brain endpoint, Agent-Control may start a temporary local
`brain mcp --root <registered-project-or-worktree>` stdio client. The root comes only from the
server-constructed `ChatScope`, never a browser/model argument. It bridges only `repo_map`,
`find_symbol`, `search_code`, and `project_commands` as `brain_*` tools, then closes the MCP
process on chat completion/error/cancellation. Unbound chats get no Brain MCP tools; skills,
knowledge, provider, and generic MCP tools are not bridged. Requires `brain` on `PATH`, or
`AGENT_BRAIN_BINARY` to point to the local executable. A bounded four-session semaphore limits
stdio subprocesses; failures degrade to existing Agent-Control tools. See ADR-0007.

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
- **Read-only/status plane:** versioned endpoints for provider capabilities, redacted accounts
  and model discovery, routing profile list/detail/revision, health/cooldown, and safe test/refresh
  operations. Do not expose credential references, bridge management keys, or raw secrets.
- **Management plane:** Brain-owned account create/test/model refresh/disable/remove and
  routing-profile CRUD, bounded OAuth sessions, redacted runtime/backend/model catalog status,
  configured-backend selection, installed hardware profile selection, and confirmed catalog
  model pull/removal for supported adapters, registered-root RAG index/search, and Brain-user
  skill inventory/validate/remove plus static MCP tool inventory. Mutations validate typed
  resources; Brain requires a restart for config changes. The management authority
  is distinct from inference credentials and is Host/same-Origin checked, authenticated, and
  CSRF-resistant.
- **Service visibility:** Settings shows redacted launchd/systemd installation and gateway health.
  Service install/uninstall stays CLI-owned because it mutates OS state and may stop the serving
  gateway.
- **Least privilege:** issue an Agent-Control inference credential scoped to approved profile
  IDs/revisions and protocols, not the Brain master token or raw provider credentials. Admin
  actions use a separate management credential. Never put either token in a chat transcript,
  model tool schema, browser persistent storage, or usage record.
- **Profile identity (2026-11-08 implementation contract):** Brain stores `routing_profiles`
  in its private router configuration. A profile maps exact caller-visible model IDs to a
  provider, upstream model, protocol set, and explicit candidate account IDs; a local target
  maps to one exact local backend model and has no account IDs. Its revision is
  `sha256:<hex>` over canonical profile data plus resolved remote provider/account/base-URL
  identities and, for local targets, the selected backend name and loopback endpoint.
  Credentials and dynamic health are excluded. A changed target or provider
  endpoint therefore creates a new revision. A scoped token authorizes one profile ID,
  revision, and protocol set. Requests carry `X-Brain-Profile` and `X-Brain-Revision`; Brain
  filters `/v1/models` to that profile and routes only through its declared target/account
  set. Profile tokens cannot access account metadata. Master-token use remains for local
  administration; rotating it revokes derived profile tokens.
- **Scoped credential files:** run `brain router credential <profile-id> --protocol chat` on
  the Brain host. It writes `~/.lokal/agent-control.token` (mode `0600`) and a non-secret
  `~/.lokal/agent-control.token.json` manifest with the current profile ID/revision. The token
  is HMAC-derived from Brain's master token but has only the selected profile/revision/protocol
  authority. The CLI refuses to overwrite either file. Rotating the master token invalidates
  all derived tokens.
- **Agent-Control contract:** each `purpose: "agent-brain"` endpoint declares
  `routingProfile: { "id": "...", "revision": "sha256:<hex>" }`. A project policy must
  include the same endpoint, profile ID, and revision in `llm.brain_profiles`. Agent-Control
  sends those values as headers on model discovery and inference; the browser cannot override
  them. Missing or mismatched profile authorization denies the request before network egress.
- **Settings UI:** Agent-Control embeds the Brain-origin management console; provider credential
  entry and OAuth consent are Brain-owned. The UI must label that local file permissions are not encrypted
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
2. **Resolved 2026-11-10:** use a Brain-origin management page embedded in Agent-Control. The
   Agent-Control backend never proxies management API traffic or receives provider secrets. Brain
   issues a distinct management credential; the page keeps it only in the Brain-origin browser
   session.
3. The management contract now covers provider capabilities, API-key/no-auth/native account
   records, Brain-managed Antigravity/Codex OAuth, no-inference account checks/model refresh,
   routing profiles, configured backend selection, hardware profile selection, and catalog-only
   Ollama model pull/unload/removal with disk/residency safeguards, and registered-root RAG
   index/search over local embeddings, Brain-user skills inventory/validate/remove, and static
   MCP tool inventory. Native CLI login, OS service installation, skill installation and
   project/configured sources, and MCP process/tool invocation remain CLI-owned. The console only
   shows trace aggregates and runs a fixed synthetic local smoke evaluation; raw trace import/
    detail and custom evaluation specs remain CLI-owned. Forge candidate inventory/evaluation and
    promotion are available only after local owner review with owned-only provenance; mining,
    drafting, hardening, and external-content promotion remain CLI-owned. Do not expose a generic
    CLI or shell endpoint to close these gaps.
4. Profile-scoped inference credentials and per-project egress policies remain separate from
   management authorization. Changing a profile requires updating the relevant project's policy
   revision before chat can use it.

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
- **2026-11-10, Brain management slices.** Brain issues a domain-separated management
  credential, rejects inference/account credentials on `/manage/v1/`, serves a Brain-origin
  operator UI, and exposes redacted provider/account and validated profile operations, supported
  OAuth sessions, credential checks/model refresh, a safe local runtime/model console,
  registered-root RAG index/search, Brain-user skill management, and read-only MCP inventory.
  Agent Control embeds only the configured Brain origin; its backend and
  frontend do not receive provider/backend secrets or the management credential. Native local
  client sign-in and the remaining Brain CLI subsystems remain open as listed above.
