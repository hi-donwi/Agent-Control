import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The one project the disposable workspace registers. */
export const PROJECT = 'mockproj';
/** The branch the fixture worktree sits on; the coding-session panel shows it. */
export const SESSION_BRANCH = 'ws-mockproj';
/** What the seeded session's panel line should contain (its last two path segments). */
export const WORKTREE_TAIL = 'worktrees/mockproj';

/** The three seeded approval requests: one live, one expired, one already decided. */
export const APPROVALS = {
  live: { id: '11111111-1111-4111-8111-111111111111', action: 'run_command' },
  expired: { id: '22222222-2222-4222-8222-222222222222', action: 'write_file' },
  decided: { id: '33333333-3333-4333-8333-333333333333', action: 'edit_file' },
};

/** A revision the inbox prints as its first eight characters. */
export const HEAD_SHA = 'a1b2c3d4' + '5'.repeat(32);

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
 * `agent stop` succeeds. `AC_STUB_WORKTREE` reaches it through the server's environment.
 */
const WS_STUB = `#!/bin/sh
if [ "$1" = "agent" ]; then
  if [ "$2" = "start" ]; then
    printf 'cd %s\\n' "$AC_STUB_WORKTREE"
  else
    echo "session stopped"
  fi
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
  const worktree = join(root, '.local', 'worktrees', PROJECT);
  const now = Date.now();

  mkdirSync(join(root, '.agents', 'bin'), { recursive: true });
  mkdirSync(join(root, 'context'), { recursive: true });
  mkdirSync(join(root, 'projects', 'mock', PROJECT), { recursive: true });
  mkdirSync(join(root, '.local', 'agent', 'approvals', PROJECT), { recursive: true });
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  mkdirSync(join(root, '.local', 'agent', 'coding-sessions'), { recursive: true });

  writeFileSync(join(root, 'AGENTS.md'), '# fixture workspace\n');
  writeFileSync(join(root, 'context', 'registry.tsv'),
    `key\tclient\tgroup\tfolder\n${PROJECT}\tframework\t-\tprojects/mock/${PROJECT}\n`);

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

  // A started session's branch comes from `git rev-parse` in the worktree, so it has to be
  // a real repository - and needs a commit before HEAD resolves to a branch.
  execFileSync('git', ['init', '-q', '-b', SESSION_BRANCH, worktree], { stdio: 'ignore' });
  execFileSync('git', ['-C', worktree, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture',
    'commit', '-q', '--allow-empty', '-m', 'fixture'], { stdio: 'ignore' });

  return { root, home, worktree };
}

export function removeWorkspace(ws: Workspace): void {
  rmSync(ws.root, { recursive: true, force: true });
  rmSync(ws.home, { recursive: true, force: true });
}
