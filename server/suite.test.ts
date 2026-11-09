import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getSuiteManifest } from './suite.js';

test('suite manifest reports local component readiness without exposing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-suite-'));
  try {
    await mkdir(join(root, '.agents', 'standards'), { recursive: true });
    await mkdir(join(root, '.agents', 'bin'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'framework marker');
    const ws = join(root, '.agents', 'bin', 'ws');
    await writeFile(ws, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await chmod(ws, 0o755);
    await mkdir(join(root, '.agents', 'skills', 'test-skill'), { recursive: true });
    await writeFile(join(root, '.agents', 'skills', 'test-skill', 'SKILL.md'), 'catalog marker');

    const manifest = await getSuiteManifest({
      workspaceRoot: root,
      brainConfigured: true,
      resolveAgentSecure: async () => '/fixture/agent-secure',
    });

    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.name, 'Agent Workspace Suite');
    assert.deepEqual(manifest.components.map(({ id }) => id), [
      'agent-control', 'agent-brain', 'agent-workspace', 'agent-skills', 'agent-secure',
    ]);
    assert.deepEqual(manifest.components.map(({ state }) => state), [
      'ready', 'configured', 'configured', 'configured', 'configured',
    ]);
    assert.equal(JSON.stringify(manifest).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('suite manifest degrades explicitly when optional or required integrations are absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-suite-empty-'));
  try {
    const manifest = await getSuiteManifest({
      workspaceRoot: root,
      brainConfigured: false,
      resolveAgentSecure: async () => { throw new Error('not installed'); },
    });
    assert.deepEqual(manifest.components.map(({ state }) => state), [
      'ready', 'not-configured', 'not-configured', 'not-installed', 'not-installed',
    ]);
    assert.ok(manifest.components.every(({ detail }) => !detail.includes(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
