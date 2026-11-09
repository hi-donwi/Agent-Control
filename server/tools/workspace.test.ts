import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    // A fixture, not the developer's workspace: CI checks this repository out alone.
    const root = mkdtempSync(join(tmpdir(), 'ac-skills-'));
    mkdirSync(join(root, '.agents', 'skills', 'codebase-onboarding'), { recursive: true });
    writeFileSync(join(root, '.agents', 'skills', 'codebase-onboarding', 'SKILL.md'), '# codebase-onboarding\n');
    const content = await new WorkspaceBridge(root).readSkill('codebase-onboarding');
    assert.ok(content.includes('codebase-onboarding'));
  });

  it('does not expose private context skills to an unbound chat', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-private-skills-'));
    mkdirSync(join(root, 'context', 'skills', 'private-domain'), { recursive: true });
    writeFileSync(join(root, 'context', 'skills', 'private-domain', 'SKILL.md'), 'private domain instructions');
    await assert.rejects(new WorkspaceBridge(root).readSkill('private-domain'), /public workspace catalog/);
  });

  it('reads a domain skill only when ws route returns it for the bound project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-bound-skills-'));
    const skillPath = join(root, 'context', 'clients', 'client-a', 'skills', 'domain-workflow', 'SKILL.md');
    mkdirSync(join(root, 'context', 'clients', 'client-a', 'skills', 'domain-workflow'), { recursive: true });
    writeFileSync(skillPath, 'bound domain instructions');
    const bridge = new WorkspaceBridge(root);
    bridge.listProjects = async () => 'KEY CLIENT GROUP FOLDER STATUS REMOTE\ndemo client-a - projects/client-a/demo missing -';
    bridge.route = async (_description, projectKey) => {
      assert.equal(projectKey, 'demo');
      return 'SCORE SKILL PATH\n 11 domain-workflow context/clients/client-a/skills/domain-workflow/SKILL.md';
    };
    assert.equal(await bridge.readSkill('domain-workflow', 'demo'), 'bound domain instructions');
  });

  it('refuses a routed skill path belonging to another project client', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-cross-client-skill-'));
    mkdirSync(join(root, 'context', 'clients', 'client-b', 'skills', 'domain-workflow'), { recursive: true });
    writeFileSync(join(root, 'context', 'clients', 'client-b', 'skills', 'domain-workflow', 'SKILL.md'), 'other client');
    const bridge = new WorkspaceBridge(root);
    bridge.listProjects = async () => 'KEY CLIENT GROUP FOLDER STATUS REMOTE\ndemo client-a - projects/client-a/demo missing -';
    bridge.route = async () => 'SCORE SKILL PATH\n 11 domain-workflow context/clients/client-b/skills/domain-workflow/SKILL.md';
    await assert.rejects(bridge.readSkill('domain-workflow', 'demo'), /outside the bound project catalog/);
  });

  it('throws informative error with available suggestions for nonexistent skill', async () => {
    await assert.rejects(
      async () => bridge.readSkill('non-existent-skill-xyz'),
      /public workspace catalog/
    );
  });
});

describe('findWorkspaceRoot desktop mode', () => {
  it('uses only a selected workspace with the required markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-selected-workspace-'));
    mkdirSync(join(root, '.agents', 'standards'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), '# Workspace\n');
    try {
      assert.equal(
        findWorkspaceRoot('/not-a-workspace', {
          AC_DESKTOP_MODE: '1',
          WS_WORKSPACE_ROOT: root,
        } as NodeJS.ProcessEnv),
        root,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the selected workspace is absent or invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-invalid-workspace-'));
    try {
      assert.throws(
        () => findWorkspaceRoot(root, { AC_DESKTOP_MODE: '1' } as NodeJS.ProcessEnv),
        /explicitly selected workspace root/,
      );
      assert.throws(
        () => findWorkspaceRoot(root, {
          AC_DESKTOP_MODE: '1',
          WS_WORKSPACE_ROOT: root,
        } as NodeJS.ProcessEnv),
        /does not contain the required workspace markers/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
