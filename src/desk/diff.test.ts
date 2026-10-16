import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from './diff';

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' keep',
  '-old line',
  '+new line',
  'diff --git a/NOTES.md b/NOTES.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/NOTES.md',
  '@@ -0,0 +1,2 @@',
  '+# Notes',
  '+--- a horizontal rule, not a header',
  '',
].join('\n');

describe('parseDiff', () => {
  it('splits files, counts lines, and marks new files', () => {
    const files = parseDiff(DIFF);
    assert.deepEqual(files.map((f) => [f.path, f.status, f.added, f.removed]), [
      ['src/app.ts', 'modified', 1, 1],
      ['NOTES.md', 'added', 2, 0],
    ]);
    assert.deepEqual(files[0].lines.map((l) => l.kind), ['hunk', 'ctx', 'del', 'add']);
  });

  it('keeps an added line that starts like a header', () => {
    assert.equal(parseDiff(DIFF)[1].lines.at(-1)!.text, '--- a horizontal rule, not a header');
  });

  it('is empty for no changes', () => {
    assert.deepEqual(parseDiff(''), []);
  });
});
