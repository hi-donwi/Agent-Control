import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, listPending } from '../approvals.js';
import { runCommand } from './run-command.js';

function gitProject(): { root: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), 'ac-runcmd-'));
  const cwd = join(root, 'projects', 'acme', 'demo');
  mkdirSync(cwd, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd });
  return { root, cwd };
}

function withPolicy(root: string, project: string, policy: unknown): void {
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'policies', `${project}.json`), JSON.stringify(policy));
}

describe('runCommand', () => {
  it('is refused with no project policy - never run', async () => {
    const { root, cwd } = gitProject();
    const result = await runCommand({ root, project: 'demo', cwd }, { command: 'echo', args: ['x'] });
    assert.ok('error' in result);
  });

  it('runs immediately when the policy marks the action read or change', async () => {
    const { root, cwd } = gitProject();
    withPolicy(root, 'demo', { schema_version: 1, default: 'read', actions: {} });
    const result = await runCommand({ root, project: 'demo', cwd }, { command: 'echo', args: ['hi'] });
    assert.ok('content' in result && result.content.includes('hi') && result.exitCode === 0);
  });

  it('reports the exit code and output of a failing command, without throwing', async () => {
    const { root, cwd } = gitProject();
    withPolicy(root, 'demo', { schema_version: 1, default: 'read', actions: {} });
    const result = await runCommand({ root, project: 'demo', cwd }, { command: 'sh', args: ['-c', 'echo oops >&2; exit 3'] });
    assert.ok('content' in result && result.exitCode === 3 && result.content.includes('oops'));
  });

  it('requires approval, then executes once approved - and only once', async () => {
    const { root, cwd } = gitProject();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    const first = await runCommand({ root, project: 'demo', cwd }, { command: 'echo', args: ['secret'] });
    assert.ok('approvalRequired' in first);
    assert.equal(listPending(root, 'demo').length, 1);

    const denied = await runCommand({ root, project: 'demo', cwd },
      { command: 'echo', args: ['secret'], approvalId: first.requestId });
    assert.ok('error' in denied && denied.error.includes('awaiting approval'));

    decide(root, 'demo', first.requestId, 'approved');
    const ran = await runCommand({ root, project: 'demo', cwd },
      { command: 'echo', args: ['secret'], approvalId: first.requestId });
    assert.ok('content' in ran && ran.content.includes('secret'));

    const again = await runCommand({ root, project: 'demo', cwd },
      { command: 'echo', args: ['secret'], approvalId: first.requestId });
    assert.ok('error' in again && again.error.includes('already consumed'));
  });

  it('voids the approval when the command changes after the request', async () => {
    const { root, cwd } = gitProject();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    const first = await runCommand({ root, project: 'demo', cwd }, { command: 'echo', args: ['a'] });
    if (!('approvalRequired' in first)) throw new Error('expected approvalRequired');
    decide(root, 'demo', first.requestId, 'approved');
    const tampered = await runCommand({ root, project: 'demo', cwd },
      { command: 'echo', args: ['b'], approvalId: first.requestId });
    assert.ok('error' in tampered && tampered.error.includes('context changed'));
  });

  it('voids the approval when the project HEAD moves after the request', async () => {
    const { root, cwd } = gitProject();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    const first = await runCommand({ root, project: 'demo', cwd }, { command: 'echo', args: ['a'] });
    if (!('approvalRequired' in first)) throw new Error('expected approvalRequired');
    decide(root, 'demo', first.requestId, 'approved');
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'later'], { cwd });
    const result = await runCommand({ root, project: 'demo', cwd },
      { command: 'echo', args: ['a'], approvalId: first.requestId });
    assert.ok('error' in result && result.error.includes('context changed'));
  });

  it('is refused outright when the operator denied it', async () => {
    const { root, cwd } = gitProject();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    const first = await runCommand({ root, project: 'demo', cwd }, { command: 'echo', args: ['a'] });
    if (!('approvalRequired' in first)) throw new Error('expected approvalRequired');
    decide(root, 'demo', first.requestId, 'denied');
    const result = await runCommand({ root, project: 'demo', cwd },
      { command: 'echo', args: ['a'], approvalId: first.requestId });
    assert.ok('error' in result && result.error.includes('denied'));
  });
});
