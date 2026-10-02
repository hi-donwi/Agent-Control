import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headSha } from './git-head.js';

describe('headSha', () => {
  it('reads the commit of a real repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-git-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
    const sha = await headSha(root);
    assert.match(sha ?? '', /^[0-9a-f]{40}$/);
  });

  it('is null outside a git repository', async () => {
    assert.equal(await headSha(mkdtempSync(join(tmpdir(), 'ac-nogit-'))), null);
  });
});
