import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectList } from './projects.js';

describe('parseProjectList', () => {
  it('reads key, client, group, and folder from `ws list`', () => {
    const output = [
      'KEY                  CLIENT       GROUP        FOLDER                          STATUS   REMOTE',
      'demo-api             acme         -            projects/acme/demo-api          ok       git@example.com:acme/demo-api.git',
      'demo-web             acme         web          projects/acme/web/demo-web      missing  -',
      '',
    ].join('\n');
    assert.deepEqual(parseProjectList(output), [
      { key: 'demo-api', client: 'acme', group: '-', folder: 'projects/acme/demo-api' },
      { key: 'demo-web', client: 'acme', group: 'web', folder: 'projects/acme/web/demo-web' },
    ]);
  });

  it('ignores colour codes and lines that are not project rows', () => {
    assert.deepEqual(parseProjectList('\u001b[1mKEY CLIENT GROUP FOLDER\u001b[0m\nno projects yet\n'), []);
  });
});
