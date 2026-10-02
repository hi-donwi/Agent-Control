import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordUsage, usagePath } from './usage.js';

describe('recordUsage (ADR-0021: endpoint, model, tokens - never content)', () => {
  it('appends one ws-usage-shaped line per request to .local/agent/usage/<month>.jsonl', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-usage-'));
    const end = new Date(2026, 9, 2, 12, 0, 0);
    const record = {
      tool: 'agent-control' as const, endpoint: 'xai', model: 'm', locality: 'remote' as const,
      project: 'demo', projectRoot: '/ws/projects/acme/demo',
      start: end.toISOString(), end: end.toISOString(), finishReason: 'stop',
      tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0 },
    };
    recordUsage(root, record);
    recordUsage(root, { ...record, endpoint: 'mock' });
    const path = usagePath(root, end);
    assert.equal(path, join(root, '.local', 'agent', 'usage', '2026-10.jsonl'));
    const lines = readFileSync(path, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.endpoint), ['xai', 'mock']);
    assert.deepEqual(lines[0].tokens, { input: 10, output: 5, cacheRead: 2, cacheWrite: 0 });
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});
