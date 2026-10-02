import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyAction, loadPolicy } from './policy.js';

function workspaceWithPolicy(project: string, policy: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'ac-policy-'));
  mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
  writeFileSync(join(root, '.local', 'agent', 'policies', `${project}.json`),
    typeof policy === 'string' ? policy : JSON.stringify(policy));
  return root;
}

const BASIC = { schema_version: 1, default: 'approval-required', actions: { inspect: 'read', edit: 'change' } };

describe('classifyAction (ADR-0014, mirrors `ws policy check`)', () => {
  it('allows an action the policy marks read or change', () => {
    const root = workspaceWithPolicy('demo', BASIC);
    assert.deepEqual(classifyAction(root, 'demo', 'inspect'), { decision: 'allow', level: 'read' });
    assert.deepEqual(classifyAction(root, 'demo', 'edit'), { decision: 'allow', level: 'change' });
  });

  it('requires approval for an action the policy marks approval-required', () => {
    const root = workspaceWithPolicy('demo', { ...BASIC, actions: { ...BASIC.actions, deploy: 'approval-required' } });
    assert.deepEqual(classifyAction(root, 'demo', 'deploy'), { decision: 'approval-required', level: 'approval-required' });
  });

  it('falls back to the policy default for an action it does not name', () => {
    const root = workspaceWithPolicy('demo', BASIC);
    assert.deepEqual(classifyAction(root, 'demo', 'unnamed'), { decision: 'approval-required', level: 'approval-required' });
  });

  it('is incomplete, never allow, for a missing or unparseable policy', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ac-policy-'));
    assert.equal(classifyAction(empty, 'demo', 'inspect').decision, 'incomplete');
    assert.equal(classifyAction(workspaceWithPolicy('demo', '{not json'), 'demo', 'inspect').decision, 'incomplete');
  });

  it('is incomplete for an unsupported schema version', () => {
    const root = workspaceWithPolicy('demo', { ...BASIC, schema_version: 2 });
    assert.equal(classifyAction(root, 'demo', 'inspect').decision, 'incomplete');
  });

  it('is incomplete for an invalid default or action level', () => {
    assert.equal(classifyAction(workspaceWithPolicy('demo', { ...BASIC, default: 'sometimes' }), 'demo', 'inspect').decision, 'incomplete');
    assert.equal(classifyAction(workspaceWithPolicy('demo', { ...BASIC, actions: { inspect: 'sometimes' } }), 'demo', 'inspect').decision, 'incomplete');
    assert.equal(classifyAction(workspaceWithPolicy('demo', { ...BASIC, actions: 'not-an-object' }), 'demo', 'inspect').decision, 'incomplete');
  });

  it('is incomplete for an invalid action label, without reading the policy', () => {
    const result = classifyAction(workspaceWithPolicy('demo', BASIC), 'demo', '../escape');
    assert.equal(result.decision, 'incomplete');
  });

  it('refuses a project key that is a path', () => {
    assert.throws(() => classifyAction('/tmp', '../etc', 'inspect'), /project key/);
  });
});

describe('loadPolicy', () => {
  it('carries the llm allowlist through unchanged, for egress.ts to read', () => {
    const root = workspaceWithPolicy('demo', { ...BASIC, llm: { endpoints: ['xai'] } });
    assert.deepEqual(loadPolicy(root, 'demo')?.llm, { endpoints: ['xai'] });
  });
});
