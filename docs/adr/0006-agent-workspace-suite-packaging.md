# ADR-0006: Package the Agent products as a component suite

- **Date:** 2026-11-08
- **Status:** Accepted
- **Deciders:** Product maintainer
- **Project:** Agent-Control

## Context

Users want Agent-Control, Agent-Brain, Agent-Skills, Agent-Secure, and Agent-Workspace
to feel like one product. They are not interchangeable modules: they have different
owners, trust boundaries, lifecycles, and runtime requirements. The current Tauri app
bundles the Agent-Control Node host only. Brain may be a separately operated service;
Agent-Workspace contains the user's selected workspace and private context; Skills is an
open-format data catalog; and Secure enforces an operator-owned policy over pinned scanner
binaries.

Combining their source repositories or running them as one process would couple release
cycles, make optional remote Brain deployments awkward, and risk putting user data,
credentials, or operator security policy inside a public application bundle.

## Decision

Present them as one user-facing **Agent Workspace Suite**, with Agent-Control as the
desktop/loopback host and orchestrator, but keep component repositories, processes, and
security authorities separate. A future suite installer/updater will assemble compatible,
individually versioned release artifacts from a signed compatibility manifest; it will not
merge source repositories or infer compatibility from floating branch names.

Component ownership and packaging boundary:

| Component | Suite role | Distribution/runtime boundary |
|---|---|---|
| Agent-Control | Host, operator UI, tool orchestration | Bundled application; owns the user-facing suite view. |
| Agent-Brain | Inference, provider accounts, credentials, model routing | Separate local or remote service; credentials stay in Brain's private runtime. |
| Agent-Workspace | `ws` framework, project/context/run contracts | A user-selected workspace checkout; suite may later offer an explicit bootstrap flow, but never bundles a user's workspace or context. |
| Agent-Skills | Portable skill source catalog | Versioned catalog synchronized into a selected workspace; do not duplicate it in the desktop binary. |
| Agent-Secure | Deterministic security gate | Separate CLI/CI component using operator-owned policy and pinned scanner digests; a readiness check never runs a scan. |

Agent-Control exposes a loopback-authenticated, read-only component readiness manifest and
shows it in Settings. It reports only whether a local integration is configured or
available. It does not probe remote services, install/update components, run scans, expose
paths or secrets, or move data between the components. The selected workspace remains the
authority for `ws`, context, skills, and project access; Agent-Brain's profile/egress policy
remains the authority for inference destinations.

The same boundary applies to runtime tool discovery: unbound chats expose no workspace tools,
remote project chats cannot route or fetch skills, and project-domain skills are retrievable only
by a local chat bound to the project for which `ws route` selected the skill. Project file/context
tools remain bound to one project and continue to use its operator egress policy when inference is
remote.

The suite release lock is strict and Ed25519-signed. It contains only the five component IDs,
semantic versions, target platform, safe artifact names for four bundled components, an
Agent-Brain service contract (no endpoint), SHA-256 digests, a generic key ID, and a sanitized
Agent-Secure attestation (scanner/policy/tool digests and a hash of the passing report). It
contains no repository URLs, filesystem paths, workspace/project names, credentials, report
contents, or release notes. The assembler refuses unlisted staging files and copies only the four
signed artifacts. A separate clean release job must build from immutable component
releases and run the approved Agent-Secure/privacy gate before a protected release key signs the
lock; an artifact signature/digest alone cannot prove that an opaque binary contains no private
data.
The implementation provides signing/verification and bundle assembly tooling but does not
generate a production key, trust anchor, component release, or installer.

## Consequences

### Positive
- The product has one suite entry point without collapsing independent engineering and
  security lifecycles.
- Operators can distinguish a configured endpoint from a live, reachable service; status
  reporting does not itself cause egress.
- A future installer can validate a tested component matrix and artifact digests.
- Workspace context, credentials, and Agent-Secure policies remain outside the app bundle.

### Negative
- A suite installer, signed artifact manifest, compatibility matrix, update/rollback flow,
  and release signing are still required before claiming a one-click full installation.
- Brain, workspace, skills, and security-gate readiness may differ by machine; some suite
  features will be unavailable until the operator configures those components.
- Component releases remain coordinated through compatibility metadata rather than one
  repository version.

### Neutral
- The existing Agent-Control desktop app remains independently runnable as the suite host.
- The current macOS arm64 desktop build remains development-only; this ADR does not expand
  its supported platforms or release status.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Merge every repository into one monorepo | Conflicts with the independent repository contract and couples unrelated release/security boundaries. |
| Build one monolithic process | Brain may be remote or resource-intensive; Secure is a CLI/CI gate; Workspace owns its own process and data. |
| Embed the selected workspace, context, or credentials | User/client data and credentials must remain operator-owned and outside a public app bundle. |
| Bundle a mutable scanner policy in Agent-Control | The scanned checkout must not control its security gate; Agent-Secure requires operator-owned policy and pinned tool digests. |
| Leave the components as undocumented, manual integrations | The existing product already depends on them, but users cannot see which integrations are configured. |

## Follow-up

- [x] Define the component/readiness contract in `GET /api/agent/suite`.
- [x] Surface readiness in Agent-Control Settings without probing or mutating components.
- [x] Add the strict signed-lock schema, Ed25519 signer/verifier, owner-only key reader, and
      allowlisted artifact assembler.
- [ ] Publish compatible component release artifacts and establish a separately trusted suite release key.
- [ ] Add a clean release job that runs Agent-Secure/privacy checks before signing the lock.
- [ ] Build an installer/update/rollback flow for the currently supported desktop platform.
- [ ] Add an explicit workspace bootstrap choice; never overwrite an existing workspace.
- [ ] Add compatibility tests across the published Agent-Control, Agent-Brain,
      Agent-Workspace, Agent-Skills, and Agent-Secure release artifacts.
