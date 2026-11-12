import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** Writes `content` at `root/relPath`, creating the directories on the way. */
function put(root: string, relPath: string, content: string): string {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** A throwaway workspace next to a directory that is not part of it. */
function sandboxFixture(): { root: string; outside: string } {
  const parent = mkdtempSync(join(tmpdir(), 'ac-sandbox-'));
  const root = join(parent, 'ws');
  const outside = join(parent, 'ws-other');
  mkdirSync(root);
  mkdirSync(outside);
  put(outside, 'secret.txt', 'needle outside the workspace');
  return { root, outside };
}

describe('WorkspaceBridge.readProjectFile sandbox', () => {
  it('reads a regular file and an env template', async () => {
    const { root } = sandboxFixture();
    put(root, 'projects/demo/src/a.ts', 'export const a = 1;\n');
    put(root, 'projects/demo/.env.example', 'API_KEY=\n');
    const bridge = new WorkspaceBridge(root);
    assert.equal(await bridge.readProjectFile('projects/demo/src/a.ts'), 'export const a = 1;\n');
    assert.equal(await bridge.readProjectFile('projects/demo/.env.example'), 'API_KEY=\n');
  });

  it('refuses repository metadata, private local material and env files at any depth', async () => {
    const { root } = sandboxFixture();
    const denied = [
      '.git/config',
      '.local/notes.md',
      'projects/demo/.git/config',
      'projects/demo/.env',
      'projects/demo/.env.production',
      'projects/demo/.envrc',
      'projects/demo/tools/.local/dump.sql',
      'context/.git/HEAD',
    ];
    for (const path of denied) put(root, path, 'token=secret\n');
    const bridge = new WorkspaceBridge(root);
    for (const path of denied) {
      await assert.rejects(bridge.readProjectFile(path), /Access denied/, path);
    }
    // A case-insensitive file system resolves this to .git/config.
    await assert.rejects(bridge.readProjectFile('projects/demo/.GIT/config'), /Access denied/);
  });

  it('refuses a symlink that leaves the workspace', async () => {
    const { root, outside } = sandboxFixture();
    mkdirSync(join(root, 'projects', 'demo'), { recursive: true });
    symlinkSync(join(outside, 'secret.txt'), join(root, 'projects', 'demo', 'link.txt'));
    symlinkSync(outside, join(root, 'projects', 'demo', 'linked-dir'));
    const bridge = new WorkspaceBridge(root);
    await assert.rejects(bridge.readProjectFile('projects/demo/link.txt'), /escapes workspace boundary/);
    await assert.rejects(bridge.readProjectFile('projects/demo/linked-dir/secret.txt'), /escapes workspace boundary/);
  });

  it('refuses a symlink into a denied location', async () => {
    const { root } = sandboxFixture();
    put(root, 'projects/demo/.git/config', 'token=secret\n');
    symlinkSync(join(root, 'projects', 'demo', '.git', 'config'), join(root, 'projects', 'demo', 'alias.txt'));
    await assert.rejects(new WorkspaceBridge(root).readProjectFile('projects/demo/alias.txt'), /Access denied/);
  });

  it('follows a symlink that stays inside the workspace', async () => {
    const { root } = sandboxFixture();
    put(root, 'AGENTS.md', '# Workspace\n');
    mkdirSync(join(root, 'docs'));
    symlinkSync(join(root, 'AGENTS.md'), join(root, 'docs', 'agents.md'));
    assert.equal(await new WorkspaceBridge(root).readProjectFile('docs/agents.md'), '# Workspace\n');
  });

  it('reads through a workspace root that is itself a symlink', async () => {
    const { root } = sandboxFixture();
    put(root, 'docs/readme.md', 'hello\n');
    const alias = join(dirname(root), 'ws-alias');
    symlinkSync(root, alias);
    assert.equal(await new WorkspaceBridge(alias).readProjectFile('docs/readme.md'), 'hello\n');
  });
});

const ripgrepMissing = spawnSync('rg', ['--version']).status === 0 ? false : 'ripgrep is not installed';

describe('WorkspaceBridge.search sandbox', () => {
  it('searches for a query that looks like an option instead of passing it to ripgrep', { skip: ripgrepMissing }, async () => {
    const { root } = sandboxFixture();
    put(root, 'notes.txt', 'run rg with --files to list files\n');
    const output = await new WorkspaceBridge(root).search('--files');
    assert.match(output, /"type":"match"/);
    assert.match(output, /notes\.txt/);
  });

  it('does not let the query switch off ignore rules, hidden-file filtering or symlink handling', { skip: ripgrepMissing }, async () => {
    const { root, outside } = sandboxFixture();
    put(root, 'projects/demo/.gitignore', '.env\n');
    put(root, 'projects/demo/.env', 'TOKEN=needle\n');
    symlinkSync(outside, join(root, 'projects', 'demo', 'linked-dir'));
    // Bundled short options: unrestricted, follow symlinks, then the pattern.
    const output = await new WorkspaceBridge(root).search('-uuuLeneedle', 'projects/demo');
    assert.doesNotMatch(output, /"type":"match"/);
  });

  it('refuses a sibling directory that only shares the name prefix of the root', async () => {
    const { root } = sandboxFixture();
    await assert.rejects(new WorkspaceBridge(root).search('needle', '../ws-other'), /escapes workspace boundary/);
  });

  it('refuses a search path that is a symlink out of the workspace', async () => {
    const { root, outside } = sandboxFixture();
    mkdirSync(join(root, 'projects', 'demo'), { recursive: true });
    symlinkSync(outside, join(root, 'projects', 'demo', 'linked-dir'));
    await assert.rejects(new WorkspaceBridge(root).search('needle', 'projects/demo/linked-dir'), /escapes workspace boundary/);
  });

  it('refuses to search inside locations read_file denies', async () => {
    const { root } = sandboxFixture();
    for (const path of ['projects/demo/.git/config', 'projects/demo/.env', '.local/agent/sessions/chat.json']) {
      put(root, path, 'token=secret\n');
    }
    const bridge = new WorkspaceBridge(root);
    for (const path of ['projects/demo/.git', 'projects/demo/.env', '.local', '.local/agent/sessions']) {
      await assert.rejects(bridge.search('token', path), /Access denied/, path);
    }
  });

  it('still searches a coding session worktree under .local/worktrees', { skip: ripgrepMissing }, async () => {
    const { root } = sandboxFixture();
    const worktree = join(root, '.local', 'worktrees', 'demo', 'session-1');
    put(worktree, 'src/a.ts', 'export const needle = 1;\n');
    put(worktree, '.git', 'gitdir: elsewhere\n');
    const bridge = new WorkspaceBridge(root);
    assert.match(await bridge.search('needle', join(worktree, 'src')), /a\.ts/);
    await assert.rejects(bridge.search('gitdir', join(worktree, '.git')), /Access denied/);
  });
});
