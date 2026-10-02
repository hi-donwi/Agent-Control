import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { egressDecision, loadLlmAllowlist } from './egress.js';
import type { Endpoint } from './endpoints.js';

const remote: Endpoint = { name: 'xai', protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', locality: 'remote', models: [] };
const local: Endpoint = { name: 'ollama', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:11434/v1', locality: 'local', models: [] };

function workspaceWithPolicy(project: string, policy: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'ac-egress-'));
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'policies', `${project}.json`),
    typeof policy === 'string' ? policy : JSON.stringify(policy));
  return root;
}

describe('egressDecision (ADR-0021)', () => {
  it('always allows a local endpoint: nothing leaves the machine', () => {
    assert.equal(egressDecision(local, undefined, null).allowed, true);
  });

  it('denies a remote endpoint by default', () => {
    assert.equal(egressDecision(remote, 'demo', null).allowed, false);
    assert.equal(egressDecision(remote, undefined, ['xai']).allowed, false);
  });

  it('allows a remote endpoint only when the project policy names it', () => {
    assert.equal(egressDecision(remote, 'demo', ['xai']).allowed, true);
    assert.equal(egressDecision(remote, 'demo', ['anthropic']).allowed, false);
  });
});

describe('loadLlmAllowlist', () => {
  it('reads llm.endpoints from the operator policy', () => {
    const root = workspaceWithPolicy('demo', { schema_version: 1, default: 'read', llm: { endpoints: ['xai'] } });
    assert.deepEqual(loadLlmAllowlist(root, 'demo'), ['xai']);
  });

  it('is null without a policy, without an llm key, or with an invalid policy', () => {
    assert.equal(loadLlmAllowlist(mkdtempSync(join(tmpdir(), 'ac-egress-')), 'demo'), null);
    assert.equal(loadLlmAllowlist(workspaceWithPolicy('demo', { schema_version: 1 }), 'demo'), null);
    assert.equal(loadLlmAllowlist(workspaceWithPolicy('demo', '{not json'), 'demo'), null);
    assert.equal(loadLlmAllowlist(workspaceWithPolicy('demo', { schema_version: 2, llm: { endpoints: ['xai'] } }), 'demo'), null);
    assert.equal(loadLlmAllowlist(workspaceWithPolicy('demo', { schema_version: 1, llm: { endpoints: 'xai' } }), 'demo'), null);
  });

  it('refuses a project key that is a path', () => {
    assert.throws(() => loadLlmAllowlist('/tmp', '../etc'), /project key/);
  });
});
