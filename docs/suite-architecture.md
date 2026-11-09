# Agent Workspace Suite

## Recommendation

Ship one user-facing **Agent Workspace Suite** with Agent-Control as its desktop/loopback
host and orchestrator. Do not merge component repositories or make their runtimes one
process. The suite should be assembled from separate, versioned artifacts using a signed
compatibility manifest and a single installer/update surface.

This is a packaging and product-surface decision, not a source-repository consolidation.
Agent-Control already integrates the components through `ws`, profile-scoped Agent-Brain
endpoints, the workspace skill catalog, and `ws scan`. The first implementation adds an
inventory of those integrations to Agent-Control Settings and a read-only status endpoint.
The full installer is a later phase: the current Tauri package contains Agent-Control's
Node host only and is not a complete multi-platform suite installer.

## Component contract

| Component | Owns | Installed/operated as | Readiness shown by Agent-Control |
|---|---|---|---|
| Agent-Control | Desk, sessions, approvals, project-bound tools, and suite UI | Bundled host and React UI | `ready` while this host is serving the page |
| Agent-Brain | Provider accounts, inference credentials, model/profile routing | Separate service; local or remote | `configured` when a `purpose: "agent-brain"` endpoint exists; no health probe is implied |
| Agent-Workspace | `ws`, project registry, context, runs, policy, and verification contracts | User-selected workspace checkout | `configured` when the selected root has framework markers and an executable `ws` entry point; doctor is not run |
| Agent-Skills | Portable Agent Skills catalog and pack metadata | Public catalog synchronized into `.agents/skills` in the selected workspace | `configured` when at least one `SKILL.md` exists in that catalog; synchronization is not verified |
| Agent-Secure | Deterministic audit verdicts, operator policy validation, scanner digest verification | Separate CLI invoked through `ws scan` or CI | `configured` when the CLI can be resolved; policy/digests are not checked and no scan is run |

The API reports only component IDs, roles, distribution modes, and readiness states. It
does not return workspace paths, project/client names, account names, provider URLs,
credential references, scanner policy contents, or skill contents. `configured` means
configuration is present, not that a remote service is healthy. A component unavailable on
one machine does not silently enable a different provider or security gate.

Chat tools follow the same privacy boundary: an unbound chat cannot inspect workspace/project
data or invoke workspace tools. Remote project chats cannot discover or fetch skills, avoiding
transmission of private catalog content to Brain. A local chat may load a domain skill only when
`ws route` returns it for that bound project. This is additive to, not a replacement for the
project's existing Brain egress policy.

## Packaging boundary

- Bundle Agent-Control's host and UI in the suite desktop installer.
- Keep Agent-Brain separately operable so the suite can use the existing remote/VM setup or
  a supported local service. If a future installer includes a local Brain artifact, it must
  be explicit and separately versioned; it must not import provider credentials.
- Provide the Agent-Workspace framework/CLI through a compatible release artifact or an
  explicit workspace bootstrap option. The user's selected workspace and its `context/`,
  `.local/`, and product repositories remain outside the application bundle.
- Pin Agent-Skills source revision in release metadata and continue to use
  `ws skills sync`; never maintain a second copy in Agent-Control.
- Distribute Agent-Secure as a separately versioned CLI/CI gate. Preserve its
  operator-owned policies, scanner digests, fail-closed verdicts, and report redaction.
- Keep per-machine endpoint credentials, Brain accounts, workspace context, project data,
  and security policy in their existing owner-controlled stores.

## Compatibility and release plan

1. **Inventory (implemented):** `GET /api/agent/suite` exposes a loopback-authenticated,
   local-only readiness manifest. Settings displays it; status checks do not run scans or
   contact Brain.
2. **Signed compatibility lock (tooling implemented):** the schema is
   `schemas/suite-lock.schema.json`. It records only the suite/component semantic versions,
  target platform, safe artifact names/SHA-256 digests for four bundled components, an
  Agent-Brain service contract/version (without an endpoint), and an Ed25519 key ID/signature.
  Repository URLs, local paths, user/workspace/project names, credentials, and arbitrary notes
  are rejected. Lock entries have one canonical order and enumerate the five named products.
3. **Reproducible release bundle (tooling implemented, no production lock yet):** sign a draft
   with a protected owner-only key using `pnpm run suite:sign-lock`, then assemble with
   `pnpm run suite:assemble` and an independently trusted public key. The artifact staging
   directory must contain exactly the four bundled artifact files named by the signed lock.
   Brain's external-service entry has no artifact file. The assembler verifies the lock signature
   and every digest, refuses symlinks/extra files/overwrite, and copies raw artifacts only; it
   does not fetch, unpack, install, or run components. No real
   release key or lock is checked in.
4. **Privacy/provenance gate (required before signing):** build from immutable component
   releases in clean release jobs, never from developer checkouts or selected workspaces.
   Before signing, CI must run the approved Agent-Secure gate and privacy/secret scan over the
   release inputs and produce a passing, reviewed build record. The suite assembler verifies
   integrity/provenance assertions; it cannot inspect the semantic contents of an opaque binary
   and is not a substitute for that gate. Keep signing keys in the release secret manager, not
   in source or package artifacts.
5. **Installer/update/rollback:** add an installer that consumes only an assembled, verified
   bundle, preserves separate component configuration, and supports rollback. Never overwrite
   an existing workspace; require an explicit choice between opening one and bootstrapping a
   new one.
6. **Platform qualification:** extend past the current macOS arm64 development build only after
   testing each bundled artifact, process lifecycle, upgrades, and rollback on that target.

### Lock signing and assembly

The release pipeline stages exactly four immutable component release assets in a private,
temporary directory; Agent-Brain is represented as a separately operated service, not a desktop
binary. `schemas/suite-lock-draft.schema.json` allows the five component IDs/versions and Brain
service contract, plus safe artifact basenames for the four bundled components.
`suite:create-lock-draft` hashes only those four staged files and serializes no staging path. The
release pipeline runs its source/artifact privacy gates, then signs the draft with the protected
release key. Signing and assembly are explicit commands:

```sh
pnpm run suite:create-lock-draft -- \
  --metadata "$SUITE_RELEASE_STAGING/metadata.json" \
  --artifacts "$SUITE_RELEASE_STAGING/artifacts" \
  --output "$SUITE_RELEASE_STAGING/draft.json"

pnpm run suite:sign-lock -- \
  --draft "$SUITE_RELEASE_STAGING/draft.json" \
  --privacy-report "$SUITE_RELEASE_STAGING/agent-secure-report.json" \
  --license-review "$SUITE_RELEASE_STAGING/license-review.json" \
  --secure-version 0.1.6 \
  --private-key "$SUITE_RELEASE_SIGNING_KEY_FILE" \
  --key-id agent-suite-release-2026 \
  --output "$SUITE_RELEASE_STAGING/suite.lock.json"

pnpm run suite:assemble -- \
  --lock "$SUITE_RELEASE_STAGING/suite.lock.json" \
  --artifacts "$SUITE_RELEASE_STAGING/artifacts" \
  --output dist/Agent-Workspace-Suite \
  --platform darwin-arm64 \
  --trusted-key "agent-suite-release-2026=$SUITE_RELEASE_PUBLIC_KEY_FILE"
```

The signing command accepts only an Agent-Secure schema-v1 report with `status: pass`, both
`gitleaks` and `osv-scanner` checks passing, no findings, no policy exceptions, and a scanner
version matching the bundled Agent-Secure component. It stores the policy digest, scanner tool
digests, and a hash of a sanitized attestation. The report's workspace root, timestamp, details,
and paths do not enter the lock and are never bundled or logged. The release job must verify that
the report came from the clean source revisions used to build the locked artifacts and that its
coverage is adequate; the signing utility validates the report structure and pass verdict.

The separate license review file must explicitly set `distribution_scope` to `private-internal`
or `external`, and attest that required notices are included and attribution is approved. No
names or notice text are stored in the lock; the signed artifact digests bind the reviewed archives.
The signing key holder must not generate this review automatically or approve personal
attribution by default.

The signing key must be held by the release secret manager (or a mode-`0600` local file); it
must never be copied into source, logs, the lock, or the bundle. The trusted public key must
come from an independently controlled trust store, not from the lock itself. The assembler
does not download artifacts, unpack archives, execute components, or install/update the suite.
It copies only the four artifact filenames in the signed lock into a **new** output directory.
The Brain entry records only its service contract/version, not an endpoint or credential. Any
extra staging file, including context, project data, credentials, or a local workspace file,
causes assembly to fail. The bundle is a verified artifact folder, not yet a desktop installer.

The lock signs hashes and release metadata, not the semantic content of an opaque binary. The
release pipeline therefore must build from clean immutable component releases, run its
operator-approved Agent-Secure and privacy/secret gates before signing, and retain sanitized
provenance evidence outside the user-facing bundle. No release lock or production key is
available yet, so the commands must not be used to create a pretend release from checkout
files.

## Release Readiness Audit

Audit performed 2026-11-08 against published component tags and GitHub release metadata:

| Component | Published release evidence | Bundle status |
|---|---|---|
| Agent-Control | No published GitHub Release artifact. | Not eligible. |
| Agent-Brain | `v1.0.0` Git tag, but no Release for the profile-scoped service contract. | Not eligible. |
| Agent-Workspace | No Git tags or GitHub Releases. | Not eligible. |
| Agent-Skills | No Git tags or GitHub Releases. | Not eligible. |
| Agent-Secure | `v0.1.6` provides Darwin/Linux assets and SHA-256 values, but no artifact signature. | Insufficient provenance for the suite lock. |

Therefore no production lock or bundle has been generated. Tests use synthetic temporary artifacts
and an ephemeral in-memory key only; neither is written to the repository.

## License and privacy release gate

The bundle must preserve each component's applicable license notices; notices must not be
rewritten or silently redacted. Agent-Control currently has no repository `LICENSE` or package
license declaration, so redistribution rights must be established before a public suite release.
The suite lock and UI omit individual names and all private paths. If a component's required
copyright notice contains personal attribution, the release owner must explicitly approve that
distribution or resolve the license before packaging; this tool never copies notices on its own.

The release job must use clean, immutable component releases, run the approved Agent-Secure and
privacy/secret gate, and sign only after both pass. The assembler validates the signed metadata,
hashes, and exact staged-file allowlist; it does not claim to inspect opaque binary contents.
No workspace `context/`, `.local/`, projects, endpoint configuration, provider credentials,
scanner policy, or skill contents are inputs to the packaging tool.

## Explicit non-goals

- No monorepo migration or source copying.
- No automatic installation, update, restart, or removal of components in this first slice.
- No remote health probe from the readiness endpoint.
- No automatic security scan or scanner policy generation.
- No actual release signing: an owner-controlled Ed25519 trust root and compatible signed release
  artifacts must exist before a production lock can be assembled.
- No packaging of credentials, private context, client/project data, or user workspaces.
- No production signing key generation, publication, or trust-root rotation in this change.
- No changes to Agent-Brain, Agent-Skills, Agent-Secure, or Agent-Workspace source in this
  Agent-Control slice.

See [ADR-0006](adr/0006-agent-workspace-suite-packaging.md) for the decision record.
