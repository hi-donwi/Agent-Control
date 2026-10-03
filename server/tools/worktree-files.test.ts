import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_FILE, editWorktreeFile, gitDiff, readWorktreeFile, writeWorktreeFile } from './worktree-files.js';

function tmpWorktree(): string {
  return mkdtempSync(join(tmpdir(), 'ac-worktree-'));
}

describe('writeWorktreeFile', () => {
  it('creates a file and its parent directories', async () => {
    const wt = tmpWorktree();
    await writeWorktreeFile(wt, 'src/new/file.ts', 'export const x = 1;\n');
    assert.equal(readFileSync(join(wt, 'src', 'new', 'file.ts'), 'utf-8'), 'export const x = 1;\n');
  });

  it('overwrites an existing file', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'a.txt'), 'old');
    await writeWorktreeFile(wt, 'a.txt', 'new');
    assert.equal(readFileSync(join(wt, 'a.txt'), 'utf-8'), 'new');
  });

  it('refuses a path that climbs out of the worktree', async () => {
    const wt = tmpWorktree();
    await assert.rejects(() => writeWorktreeFile(wt, '../escape.txt', 'x'), /outside the worktree/);
    await assert.rejects(() => writeWorktreeFile(wt, '/etc/passwd', 'x'), /outside the worktree/);
  });
});

describe('readWorktreeFile', () => {
  it('reads a file written into the worktree', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'a.txt'), 'hello');
    assert.equal(await readWorktreeFile(wt, 'a.txt'), 'hello');
  });

  it('refuses a path outside the worktree', async () => {
    const wt = tmpWorktree();
    await assert.rejects(() => readWorktreeFile(wt, '../../etc/passwd'), /outside the worktree/);
  });

  it('refuses a directory - the same "must be a file" guard bridge.readProjectFile has', async () => {
    const wt = tmpWorktree();
    mkdirSync(join(wt, 'adir'));
    await assert.rejects(() => readWorktreeFile(wt, 'adir'), /not a file/i);
  });

  it('refuses a file over the size cap, naming it', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'big.txt'), 'x'.repeat(MAX_FILE + 1));
    await assert.rejects(() => readWorktreeFile(wt, 'big.txt'), /too large/i);
  });

  it('accepts a file exactly at the cap', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'exact.txt'), 'x'.repeat(MAX_FILE));
    assert.equal((await readWorktreeFile(wt, 'exact.txt')).length, MAX_FILE);
  });
});

describe('editWorktreeFile (exact, unique replacement)', () => {
  it('replaces a unique match', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'a.ts'), 'const x = 1;\nconst y = 2;\n');
    const result = await editWorktreeFile(wt, 'a.ts', 'const x = 1;', 'const x = 100;');
    assert.deepEqual(result, { replaced: true });
    assert.equal(readFileSync(join(wt, 'a.ts'), 'utf-8'), 'const x = 100;\nconst y = 2;\n');
  });

  it('refuses when the text is not found', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'a.ts'), 'const x = 1;\n');
    const result = await editWorktreeFile(wt, 'a.ts', 'const z = 9;', 'const z = 10;');
    assert.deepEqual(result, { error: 'oldString was not found in a.ts' });
  });

  it('refuses when the text matches more than once, naming the count', async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, 'a.ts'), 'x\nx\n');
    const result = await editWorktreeFile(wt, 'a.ts', 'x', 'y');
    assert.deepEqual(result, { error: 'oldString matches 2 places in a.ts - include more context to make it unique' });
  });
});

describe('gitDiff', () => {
  it('shows unstaged changes in the worktree', async () => {
    const wt = tmpWorktree();
    execFileSync('git', ['init', '-q'], { cwd: wt });
    writeFileSync(join(wt, 'a.txt'), 'one\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: wt });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: wt });
    writeFileSync(join(wt, 'a.txt'), 'two\n');
    const diff = await gitDiff(wt);
    assert.match(diff, /-one/);
    assert.match(diff, /\+two/);
  });

  it('shows a brand new, untracked file as entirely added - not just a modified one', async () => {
    const wt = tmpWorktree();
    execFileSync('git', ['init', '-q'], { cwd: wt });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: wt });
    writeFileSync(join(wt, 'brand-new.ts'), 'export const x = 1;\n');
    const diff = await gitDiff(wt);
    assert.match(diff, /brand-new\.ts/);
    assert.match(diff, /\+export const x = 1;/);
  });

  it('is empty text for a clean worktree, not an error', async () => {
    const wt = tmpWorktree();
    execFileSync('git', ['init', '-q'], { cwd: wt });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: wt });
    assert.equal(await gitDiff(wt), '');
  });

  it('is scoped to one path when given one, with the same traversal guard', async () => {
    const wt = tmpWorktree();
    execFileSync('git', ['init', '-q'], { cwd: wt });
    mkdirSync(join(wt, 'sub'));
    writeFileSync(join(wt, 'a.txt'), 'a\n');
    writeFileSync(join(wt, 'sub', 'b.txt'), 'b\n');
    execFileSync('git', ['add', '-A'], { cwd: wt });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: wt });
    writeFileSync(join(wt, 'a.txt'), 'a2\n');
    writeFileSync(join(wt, 'sub', 'b.txt'), 'b2\n');
    const scoped = await gitDiff(wt, 'sub/b.txt');
    assert.match(scoped, /b2/);
    assert.doesNotMatch(scoped, /a2/);
    await assert.rejects(() => gitDiff(wt, '../escape'), /outside the worktree/);
  });
});
