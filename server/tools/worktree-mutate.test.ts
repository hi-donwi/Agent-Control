import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../approvals.js';
import { editFileTool, writeFileTool } from './worktree-mutate.js';

function session(): { root: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), 'ac-mutate-'));
  const worktree = join(root, '.local', 'worktrees', 'demo', 'session1');
  mkdirSync(worktree, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: worktree });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: worktree });
  return { root, worktree };
}

function withPolicy(root: string, project: string, policy: unknown): void {
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'policies', `${project}.json`), JSON.stringify(policy));
}

describe('writeFileTool', () => {
  it('writes immediately when the policy allows it', async () => {
    const { root, worktree } = session();
    withPolicy(root, 'demo', { schema_version: 1, default: 'change', actions: {} });
    const result = await writeFileTool({ root, project: 'demo', worktree }, { path: 'src/a.ts', content: 'x' });
    assert.deepEqual(result, { ok: true });
    assert.equal(readFileSync(join(worktree, 'src', 'a.ts'), 'utf-8'), 'x');
  });

  it('requires approval, then writes once approved - and only once', async () => {
    const { root, worktree } = session();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    const first = await writeFileTool({ root, project: 'demo', worktree }, { path: 'a.txt', content: 'secret' });
    assert.ok('approvalRequired' in first);
    decide(root, 'demo', first.requestId, 'approved');
    const ran = await writeFileTool({ root, project: 'demo', worktree }, { path: 'a.txt', content: 'secret', approvalId: first.requestId });
    assert.deepEqual(ran, { ok: true });
    const again = await writeFileTool({ root, project: 'demo', worktree }, { path: 'a.txt', content: 'secret', approvalId: first.requestId });
    assert.ok('error' in again && again.error.includes('already consumed'));
  });

  it('is refused outright with no project policy', async () => {
    const { root, worktree } = session();
    const result = await writeFileTool({ root, project: 'demo', worktree }, { path: 'a.txt', content: 'x' });
    assert.ok('error' in result);
  });
});

describe('editFileTool', () => {
  it('edits immediately when the policy allows it', async () => {
    const { root, worktree } = session();
    withPolicy(root, 'demo', { schema_version: 1, default: 'change', actions: {} });
    writeFileSync(join(worktree, 'a.ts'), 'const x = 1;\n');
    const result = await editFileTool({ root, project: 'demo', worktree }, { path: 'a.ts', oldString: 'x = 1', newString: 'x = 2' });
    assert.deepEqual(result, { ok: true });
    assert.equal(readFileSync(join(worktree, 'a.ts'), 'utf-8'), 'const x = 2;\n');
  });

  it('surfaces an ambiguous match as an error, without writing, even when the policy allows the edit', async () => {
    const { root, worktree } = session();
    withPolicy(root, 'demo', { schema_version: 1, default: 'change', actions: {} });
    writeFileSync(join(worktree, 'a.ts'), 'x\nx\n');
    const result = await editFileTool({ root, project: 'demo', worktree }, { path: 'a.ts', oldString: 'x', newString: 'y' });
    assert.ok('error' in result && result.error.includes('matches 2 places'));
    assert.equal(readFileSync(join(worktree, 'a.ts'), 'utf-8'), 'x\nx\n');
  });

  it('requires approval before touching the file', async () => {
    const { root, worktree } = session();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    writeFileSync(join(worktree, 'a.ts'), 'const x = 1;\n');
    const first = await editFileTool({ root, project: 'demo', worktree }, { path: 'a.ts', oldString: 'x = 1', newString: 'x = 2' });
    assert.ok('approvalRequired' in first);
    assert.equal(readFileSync(join(worktree, 'a.ts'), 'utf-8'), 'const x = 1;\n');
    decide(root, 'demo', first.requestId, 'denied');
    const denied = await editFileTool({ root, project: 'demo', worktree }, { path: 'a.ts', oldString: 'x = 1', newString: 'x = 2', approvalId: first.requestId });
    assert.ok('error' in denied && denied.error.includes('denied'));
  });

  it('voids the approval when the edit is changed after the request', async () => {
    const { root, worktree } = session();
    withPolicy(root, 'demo', { schema_version: 1, default: 'approval-required', actions: {} });
    writeFileSync(join(worktree, 'a.ts'), 'const x = 1;\n');
    const first = await editFileTool({ root, project: 'demo', worktree }, { path: 'a.ts', oldString: 'x = 1', newString: 'x = 2' });
    if (!('approvalRequired' in first)) throw new Error('expected approvalRequired');
    decide(root, 'demo', first.requestId, 'approved');
    const tampered = await editFileTool({ root, project: 'demo', worktree }, { path: 'a.ts', oldString: 'x = 1', newString: 'x = 999', approvalId: first.requestId });
    assert.ok('error' in tampered && tampered.error.includes('context changed'));
  });
});
