import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The one project the disposable workspace registers. */
export const PROJECT = 'mockproj';
/** The branch the fixture worktree sits on; the coding-session panel shows it. */
export const SESSION_BRANCH = 'ws-mockproj';
/** What the seeded session's panel line should contain (its last two path segments). */
export const WORKTREE_TAIL = 'mockproj/fixture';
/** Where the seeded session's worktree is, under the workspace root. */
export const worktreeOf = (root: string) => join(root, '.local', 'worktrees', PROJECT, 'fixture');
/** The bare repository the product checkout and the session push to. */
export const originOf = (root: string) => join(root, '.local', 'fixture-origin.git');
/** Write `pass`, `findings`, or `incomplete` here to steer the stub `ws verify`. */
export const verifyStatusFile = (root: string) => join(root, '.local', 'agent', 'stub-verify-status');

/** The three seeded approval requests: one live, one expired, one already decided. */
export const APPROVALS = {
  live: { id: '11111111-1111-4111-8111-111111111111', action: 'run_command' },
  expired: { id: '22222222-2222-4222-8222-222222222222', action: 'write_file' },
  decided: { id: '33333333-3333-4333-8333-333333333333', action: 'edit_file' },
};

/** A revision the inbox prints as its first eight characters. */
export const HEAD_SHA = 'a1b2c3d4' + '5'.repeat(32);

/** Seeded legacy provider keys, and the mask the API must answer with (first eight + `...`). */
export const OPENAI_KEY = 'sk-fixture-openai-key';
export const ANTHROPIC_KEY = 'sk-ant-fixture-key';
export const MASKED_OPENAI_KEY = 'sk-fixtu...';
export const MASKED_ANTHROPIC_KEY = 'sk-ant-f...';
/** What the settings spec saves as a new Google key. */
export const NEW_GOOGLE_KEY = 'AIza-fixture-google-key';

export interface Workspace {
  /** `WS_WORKSPACE_ROOT`: the disposable workspace every fixture file lives in. */
  root: string;
  /** `HOME`: isolated so the operator's real `~/.agent-control/config.json` is never read. */
  home: string;
  /** The worktree a started coding session reports. */
  worktree: string;
}

const APPROVAL_TTL_MS = 15 * 60 * 1000;

function approvalRequest(id: string, action: string, now: number, ttlMs: number) {
  return {
    type: 'requested' as const,
    id,
    project: PROJECT,
    headSha: HEAD_SHA,
    action,
    inputHash: 'f'.repeat(64),
    policyHash: 'e'.repeat(64),
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

/**
 * A `ws` CLI the bridge can shell out to. `list` answers the registry, `agent start`
 * prints the one machine-readable `cd <path>` line `coding-sessions.ts` parses, and
 * `agent stop` succeeds. `note`, `task`, and `plan` write the files the real commands
 * would, without their revision checks. `AC_STUB_WORKTREE` reaches it through the
 * server's environment.
 */
const WS_STUB = `#!/bin/sh
if [ "$1" = "agent" ]; then
  if [ "$2" = "start" ]; then
    printf 'cd %s\\n' "$AC_STUB_WORKTREE"
  else
    echo "session stopped"
  fi
elif [ "$1" = "verify" ]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  st="pass"
  [ -f "$root/.local/agent/stub-verify-status" ] && st="$(cat "$root/.local/agent/stub-verify-status")"
  cs="pass"; [ "$st" = "pass" ] || cs="failed"
  printf '{"version": 1, "project": "%s", "status": "%s", "commands": [{"id": "unit-tests", "required": true, "status": "%s", "duration_ms": 1200}]}\\n' "$2" "$st" "$cs"
  [ "$st" = "pass" ] && exit 0
  [ "$st" = "findings" ] && exit 1
  exit 2
elif [ "$1" = "note" ]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  dir="$root/context/memory/projects/$2/notes"
  slug="$(printf '%s' "$3" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/^-*//; s/-*$//')"
  mkdir -p "$dir"
  { printf '# %s\\n\\n' "$3"; cat; } > "$dir/$slug.md"
  printf 'note context/memory/projects/%s/notes/%s.md\\n' "$2" "$slug"
elif [ "$1" = "task" ]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  dir="$root/context/tasks/$3"
  if [ "$2" = "add" ]; then
    id="task_$(printf '%s' "$4" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '_' | sed 's/^_*//; s/_*$//')"
    mkdir -p "$dir"
    cat > /dev/null
    printf -- '---\\nschema_version: 1\\nid: %s\\nproject: %s\\ntitle: %s\\nstatus: backlog\\npriority: %s\\nowner: desk\\nupdated_at: 2026-10-16T10:00:00+07:00\\n---\\n' "$id" "$3" "$4" "$6" > "$dir/$id.md"
    printf 'task %s backlog mtime:0:size:0\\n' "$id"
  elif [ "$2" = "block" ]; then
    f="$dir/$4.md"
    sed '/^blocked/d' "$f" | awk -v r="$5" 'NR > 1 && $0 == "---" && !d { print "blocked: true"; print "blocked_reason: \\"" r "\\""; d = 1 } { print }' > "$f.tmp" && mv "$f.tmp" "$f"
    printf 'task %s blocked mtime:0:size:0\\n' "$4"
  elif [ "$2" = "unblock" ]; then
    f="$dir/$4.md"
    sed '/^blocked/d' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    printf 'task %s unblocked mtime:0:size:0\\n' "$4"
  else
    f="$dir/$4.md"
    sed "s/^status: .*/status: $5/" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    printf 'task %s %s mtime:0:size:0\\n' "$4" "$5"
  fi
elif [ "$1" = "plan" ]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  f="$root/context/runs/$3/$4/plan.md"
  q="$(printf '\\140')"
  sn=0; nt=""
  if [ "\${10}" = "--notes" ]; then sn=1; nt="\${11}"; fi
  awk -F'|' -v n="$5" -v st="$6" -v q="$q" -v sn="$sn" -v nt="$nt" 'BEGIN { OFS = "|" } { c = $2; gsub(/ /, "", c); if (NF > 4 && c == n) { $4 = " " q st q " "; if (sn == 1) $5 = " " nt " " } print }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  printf 'plan %s %s %s mtime:0:size:0\\n' "$4" "$5" "$6"
else
  printf '${PROJECT}\\tframework\\t-\\tprojects/mock/${PROJECT}\\t-\\t-\\t-\\n'
fi
`;

/**
 * Builds the workspace the UI is driven against: a disposable directory tree - endpoint
 * config, policy, approvals, a coding session, a stub `ws`, and a real git worktree - so
 * a browser test exercises the real server end to end without a network call, a real
 * workspace, or the operator's own state.
 */
export function createWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'ac-ui-root-'));
  const home = mkdtempSync(join(tmpdir(), 'ac-ui-home-'));
  const worktree = worktreeOf(root);
  const now = Date.now();

  mkdirSync(join(root, '.agents', 'bin'), { recursive: true });
  mkdirSync(join(root, 'context'), { recursive: true });
  mkdirSync(join(root, '.local', 'worktrees', PROJECT), { recursive: true });
  mkdirSync(join(root, '.local', 'agent', 'approvals', PROJECT), { recursive: true });
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  mkdirSync(join(root, '.local', 'agent', 'coding-sessions'), { recursive: true });

  writeFileSync(join(root, 'AGENTS.md'), '# fixture workspace\n');
  writeFileSync(join(root, 'context', 'registry.tsv'),
    `key\tclient\tgroup\tfolder\n${PROJECT}\tframework\t-\tprojects/mock/${PROJECT}\n`);

  // The legacy config lives outside the workspace, in the isolated home: a real (but fake)
  // key per provider, so the settings spec can assert the API masks it and a save does not
  // write the mask back.
  mkdirSync(join(home, '.agent-control'), { recursive: true });
  writeFileSync(join(home, '.agent-control', 'config.json'), JSON.stringify({
    providers: { openai: { apiKey: OPENAI_KEY }, anthropic: { apiKey: ANTHROPIC_KEY } },
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
  }, null, 2));

  // `mock` answers offline; `remote` is declared to prove the UI disables it unless the
  // project's policy allows it. Neither is ever called with a credential.
  writeFileSync(join(root, '.local', 'agent', 'endpoints.json'), JSON.stringify({
    endpoints: {
      mock: { protocol: 'mock', models: ['echo'] },
      remote: { protocol: 'openai-chat', baseUrl: 'https://example.invalid/v1', models: ['x'] },
    },
  }, null, 2));
  writeFileSync(join(root, '.local', 'agent', 'policies', `${PROJECT}.json`), JSON.stringify({
    schema_version: 1, default: 'read', llm: { endpoints: [] },
  }, null, 2));

  const events = [
    approvalRequest(APPROVALS.live.id, APPROVALS.live.action, now, APPROVAL_TTL_MS),
    approvalRequest(APPROVALS.expired.id, APPROVALS.expired.action, now, -APPROVAL_TTL_MS),
    approvalRequest(APPROVALS.decided.id, APPROVALS.decided.action, now, APPROVAL_TTL_MS),
    { type: 'approved', id: APPROVALS.decided.id, project: PROJECT, decidedAt: new Date(now).toISOString() },
  ];
  writeFileSync(
    join(root, '.local', 'agent', 'approvals', PROJECT, `${new Date(now).toISOString().slice(0, 7)}.jsonl`),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  writeFileSync(join(root, '.local', 'agent', 'coding-sessions', `${PROJECT}.json`), JSON.stringify({
    id: '44444444-4444-4444-8444-444444444444',
    project: PROJECT,
    worktree,
    branch: SESSION_BRANCH,
    startedAt: new Date(now).toISOString(),
  }, null, 2) + '\n');

  const ws = join(root, '.agents', 'bin', 'ws');
  writeFileSync(ws, WS_STUB);
  chmodSync(ws, 0o755);

  // What a real session has: a product checkout cloned from a bare origin, and the session
  // worktree on its own branch beside it - so verify, ship, and discard run real git. A
  // started session's branch comes from `git rev-parse` in the worktree.
  const origin = originOf(root);
  const primary = join(root, 'projects', 'mock', PROJECT);
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
  execFileSync('git', ['clone', '-q', origin, primary], { stdio: 'ignore' });
  run(primary, 'config', 'user.email', 'fixture@example.invalid');
  run(primary, 'config', 'user.name', 'fixture');
  writeFileSync(join(primary, 'README.md'), '# mock product\n');
  run(primary, 'add', '-A');
  run(primary, 'commit', '-q', '-m', 'fixture');
  run(primary, 'push', '-q', 'origin', 'HEAD:main');
  run(primary, 'remote', 'set-head', 'origin', 'main');
  run(primary, 'worktree', 'add', '-q', '-b', SESSION_BRANCH, worktree);

  return { root, home, worktree };
}

export function removeWorkspace(ws: Workspace): void {
  rmSync(ws.root, { recursive: true, force: true });
  rmSync(ws.home, { recursive: true, force: true });
}
