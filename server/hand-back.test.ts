import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodingSession, type CodingSession } from './coding-sessions.js';
import { HandBackConflict, discardSession, shipSession, startVerify, worktreeTree, type HandBackDeps } from './hand-back.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
const ID = { name: 'fixture', email: 'fixture@example.invalid' };

/**
 * A disposable workspace with what a coding session really has: a bare `origin`, the
 * primary checkout on main, and the session's worktree on its own branch under
 * `.local/worktrees/<key>/`.
 */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'ac-handback-'));
  const origin = join(root, 'origin.git');
  const primary = join(root, 'projects', 'demo');
  const worktree = join(root, '.local', 'worktrees', 'demo', 's1');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, primary], { stdio: 'ignore' });
  for (const [k, v] of Object.entries({ 'user.name': ID.name, 'user.email': ID.email })) git(primary, 'config', k, v);
  writeFileSync(join(primary, 'README.md'), '# demo\n');
  git(primary, 'add', '-A');
  git(primary, 'commit', '-q', '-m', 'initial');
  git(primary, 'push', '-q', 'origin', 'HEAD:main');
  git(primary, 'remote', 'set-head', 'origin', 'main');
  mkdirSync(join(root, '.local', 'worktrees', 'demo'), { recursive: true });
  git(primary, 'worktree', 'add', '-q', '-b', 'agent-s1', worktree);
  const session: CodingSession = { id: 's1-id', project: 'demo', worktree, branch: 'agent-s1', startedAt: '2026-10-17T00:00:00.000Z' };
  mkdirSync(join(root, '.local', 'agent', 'coding-sessions'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'coding-sessions', 'demo.json'), JSON.stringify(session));
  return { root, origin, primary, worktree };
}

/** `ws verify` answers with `status`; every call is recorded. */
function fakeWs(status: 'pass' | 'findings' | 'incomplete' | 'refuse' = 'pass') {
  const calls: string[][] = [];
  const deps: HandBackDeps = {
    ws: async (args) => {
      calls.push(args);
      if (args[0] !== 'verify') return { code: 0, stdout: '', stderr: '' };
      if (status === 'refuse') return { code: 1, stdout: '', stderr: '\u001b[31merror: no operator contract at /x/demo.json\u001b[0m\n' };
      const report = { version: 1, project: 'demo', status, commands: [{ id: 'tests', required: true, status: status === 'pass' ? 'pass' : 'failed', duration_ms: 5 }] };
      return { code: status === 'pass' ? 0 : status === 'findings' ? 1 : 2, stdout: JSON.stringify(report), stderr: '' };
    },
  };
  return { deps, calls };
}

describe('hand back', () => {
  let ws: ReturnType<typeof workspace>;
  beforeEach(() => { ws = workspace(); });
  afterEach(() => rmSync(ws.root, { recursive: true, force: true }));

  it('fingerprints the worktree content, untracked files included, without touching its index', async () => {
    const clean = await worktreeTree(ws.worktree);
    assert.equal(clean, git(ws.worktree, 'rev-parse', 'HEAD^{tree}'));
    writeFileSync(join(ws.worktree, 'new.txt'), 'from the agent\n');
    const dirty = await worktreeTree(ws.worktree);
    assert.notEqual(dirty, clean);
    assert.equal(git(ws.worktree, 'status', '--porcelain'), '?? new.txt');
  });

  it('verifies the session worktree through ws verify and keeps the result with the content it saw', async () => {
    writeFileSync(join(ws.worktree, 'new.txt'), 'from the agent\n');
    const { deps, calls } = fakeWs('pass');
    const { session, done } = await startVerify(ws.root, 'demo', deps);
    assert.equal(session.verify?.state, 'running');
    await done;
    assert.deepEqual(calls[0], ['verify', 'demo', '--worktree', ws.worktree, '--json']);
    const verify = readCodingSession(ws.root, 'demo')!.verify!;
    assert.equal(verify.state, 'pass');
    assert.equal(verify.tree, await worktreeTree(ws.worktree));
    assert.deepEqual(verify.commands, [{ id: 'tests', required: true, status: 'pass', duration_ms: 5 }]);
  });

  it('says why verify could not run, without the colour codes', async () => {
    const { deps } = fakeWs('refuse');
    await (await startVerify(ws.root, 'demo', deps)).done;
    const verify = readCodingSession(ws.root, 'demo')!.verify!;
    assert.equal(verify.state, 'error');
    assert.equal(verify.error, 'no operator contract at /x/demo.json');
  });

  it('ships a verified change to main: commits it, checks it is a fast-forward, and pushes', async () => {
    writeFileSync(join(ws.worktree, 'feature.txt'), 'shipped\n');
    const { deps } = fakeWs('pass');
    await (await startVerify(ws.root, 'demo', deps)).done;
    git(ws.worktree, 'config', 'user.name', ID.name);
    git(ws.worktree, 'config', 'user.email', ID.email);

    const shipped = await shipSession(ws.root, 'demo', 'feat: add the feature');
    assert.equal(shipped.base, 'main');
    assert.equal(shipped.commits, 1);
    assert.equal(git(ws.origin, 'rev-parse', 'main'), shipped.head);
    assert.equal(git(ws.origin, 'log', '-1', '--format=%s', 'main'), 'feat: add the feature');
    assert.equal(readCodingSession(ws.root, 'demo')!.shipped?.head, shipped.head);
  });

  it('refuses to ship without a passing verify, or after the worktree changed since', async () => {
    writeFileSync(join(ws.worktree, 'feature.txt'), 'v1\n');
    await assert.rejects(shipSession(ws.root, 'demo', 'feat: x'), /verify must pass/);

    await (await startVerify(ws.root, 'demo', fakeWs('findings').deps)).done;
    await assert.rejects(shipSession(ws.root, 'demo', 'feat: x'), /verify must pass/);

    await (await startVerify(ws.root, 'demo', fakeWs('pass').deps)).done;
    writeFileSync(join(ws.worktree, 'feature.txt'), 'v2\n');
    await assert.rejects(shipSession(ws.root, 'demo', 'feat: x'), (err: Error) =>
      err instanceof HandBackConflict && /changed since it was verified/.test(err.message));
    assert.equal(git(ws.origin, 'rev-parse', 'main'), git(ws.primary, 'rev-parse', 'HEAD'));
  });

  it('refuses a commit without a message, and a branch main has moved past', async () => {
    writeFileSync(join(ws.worktree, 'feature.txt'), 'shipped\n');
    const { deps } = fakeWs('pass');
    await (await startVerify(ws.root, 'demo', deps)).done;
    await assert.rejects(shipSession(ws.root, 'demo', '   '), /needs a message/);

    // Someone else lands on main first: the session branch is no longer a fast-forward.
    writeFileSync(join(ws.primary, 'other.txt'), 'elsewhere\n');
    git(ws.primary, 'add', '-A');
    git(ws.primary, 'commit', '-q', '-m', 'other');
    git(ws.primary, 'push', '-q', 'origin', 'HEAD:main');
    const before = git(ws.origin, 'rev-parse', 'main');
    git(ws.worktree, 'config', 'user.name', ID.name);
    git(ws.worktree, 'config', 'user.email', ID.email);
    await assert.rejects(shipSession(ws.root, 'demo', 'feat: late'), (err: Error) =>
      err instanceof HandBackConflict && /origin\/main has moved/.test(err.message));
    assert.equal(git(ws.origin, 'rev-parse', 'main'), before);
  });

  it('discards a session: stops it, removes its worktree and branch, and forgets it', async () => {
    writeFileSync(join(ws.worktree, 'scratch.txt'), 'throwaway\n');
    const { deps, calls } = fakeWs();
    await discardSession(ws.root, 'demo', deps);
    assert.deepEqual(calls[0], ['agent', 'stop', 'agent-control session discarded']);
    assert.equal(existsSync(ws.worktree), false);
    assert.equal(git(ws.primary, 'branch', '--list', '--format=%(refname:short)', 'agent-s1'), '');
    assert.equal(readCodingSession(ws.root, 'demo'), null);
  });

  it('never deletes a worktree outside the project\'s own worktrees', async () => {
    const elsewhere = join(ws.root, 'elsewhere');
    mkdirSync(elsewhere);
    const record = join(ws.root, '.local', 'agent', 'coding-sessions', 'demo.json');
    writeFileSync(record, JSON.stringify({ id: 'x', project: 'demo', worktree: elsewhere, branch: 'agent-s1', startedAt: '' }));
    await assert.rejects(discardSession(ws.root, 'demo', fakeWs().deps), /under \.local\/worktrees\/demo/);
    assert.equal(existsSync(elsewhere), true);
    assert.equal(git(ws.primary, 'branch', '--list', '--format=%(refname:short)', 'agent-s1'), 'agent-s1');
  });
});
