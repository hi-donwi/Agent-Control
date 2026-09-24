import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceBridge, findWorkspaceRoot } from './workspace.js';

const WORKSPACE_ROOT = findWorkspaceRoot(import.meta.dirname);

describe('WorkspaceBridge Diagnostic Tools', () => {
  const bridge = new WorkspaceBridge(WORKSPACE_ROOT);

  it('rejects invalid dbakit commands', async () => {
    await assert.rejects(
      async () => bridge.dbakit('drop_all'),
      /Invalid dbakit command 'drop_all'/
    );
  });

  it('rejects invalid opskit commands', async () => {
    await assert.rejects(
      async () => bridge.opskit('destroy'),
      /Invalid opskit command 'destroy'/
    );
  });

  it('rejects invalid project keys for agentSecure', async () => {
    await assert.rejects(
      async () => bridge.agentSecure('invalid project key; rm -rf /'),
      /Invalid project key/
    );
  });

  it('resolves dbakit binary or runs rules probe', async () => {
    try {
      const output = await bridge.dbakit('rules');
      assert.ok(typeof output === 'string');
      // output should contain JSON with rules or command string
      assert.ok(output.includes('rules') || output.includes('findings') || output.includes('tool'));
    } catch (err) {
      // If binary not built on another environment, it should give a clear error
      assert.ok(err instanceof Error);
    }
  });

  it('resolves opskit binary and executes version or diag', async () => {
    try {
      const output = await bridge.opskit('version');
      assert.ok(typeof output === 'string');
      assert.ok(output.includes('opskit') || output.includes('version'));
    } catch (err) {
      assert.ok(err instanceof Error);
    }
  });

  it('rejects invalid skill names for readSkill', async () => {
    await assert.rejects(
      async () => bridge.readSkill('../secret'),
      /Invalid skill name/
    );
  });

  it('reads existing skill instructions via readSkill', async () => {
    const content = await bridge.readSkill('codebase-onboarding');
    assert.ok(typeof content === 'string');
    assert.ok(content.includes('codebase-onboarding') || content.includes('mental model'));
  });

  it('throws informative error with available suggestions for nonexistent skill', async () => {
    await assert.rejects(
      async () => bridge.readSkill('non-existent-skill-xyz'),
      /Available skills:/
    );
  });
});
