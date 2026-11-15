import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createLoginShellEnvironment, parseLoginShellPath, ToolDependencyError, ToolLocator } from './tool-locator.js';

async function executable(path: string) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '#!/bin/sh\nexit 0\n');
  await chmod(path, 0o700);
}

function binaryPath(directory: string, name: string): string {
  return join(directory, process.platform === 'win32' ? `${name}.exe` : name);
}

test('search order is bundled, user bin, Homebrew, login shell, then inherited PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-locator-order-'));
  const bundled = join(root, 'bundle');
  const home = join(root, 'home');
  const brew = join(root, 'brew');
  const login = join(root, 'login');
  const inherited = join(root, 'path');
  const overrides = join(home, '.agent-control', 'tool-paths.json');
  const candidates = [bundled, join(home, '.agent-control', 'bin'), brew, login, inherited];
  try {
    await Promise.all(candidates.map((directory) => executable(binaryPath(directory, 'rg'))));
    const locator = new ToolLocator({
      homeDir: home,
      bundledDirs: [bundled],
      homebrewDirs: [brew],
      loginShellPathDirs: [login],
      inheritedPathDirs: [inherited],
      overridesPath: overrides,
    });

    assert.equal(locator.status().find((tool) => tool.name === 'rg')?.path, await realpath(binaryPath(bundled, 'rg')));
    const ordered = [
      { bundledDirs: [bundled], homeDir: home, homebrewDirs: [brew], loginShellPathDirs: [login], inheritedPathDirs: [inherited], source: 'bundled' },
      { bundledDirs: [], homeDir: home, homebrewDirs: [brew], loginShellPathDirs: [login], inheritedPathDirs: [inherited], source: 'user-bin' },
      { bundledDirs: [], homeDir: join(root, 'empty-home'), homebrewDirs: [brew], loginShellPathDirs: [login], inheritedPathDirs: [inherited], source: 'homebrew' },
      { bundledDirs: [], homeDir: join(root, 'empty-home'), homebrewDirs: [], loginShellPathDirs: [login], inheritedPathDirs: [inherited], source: 'login-shell' },
      { bundledDirs: [], homeDir: join(root, 'empty-home'), homebrewDirs: [], loginShellPathDirs: [], inheritedPathDirs: [inherited], source: 'path' },
    ] as const;
    for (const paths of ordered) {
      const candidateLocator = new ToolLocator({
        homeDir: paths.homeDir,
        bundledDirs: [...paths.bundledDirs],
        homebrewDirs: [...paths.homebrewDirs],
        loginShellPathDirs: [...paths.loginShellPathDirs],
        inheritedPathDirs: [...paths.inheritedPathDirs],
        overridesPath: join(root, `overrides-${paths.source}.json`),
      });
      assert.equal(candidateLocator.status().find((tool) => tool.name === 'rg')?.source, paths.source);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('valid overrides persist across locator instances and take precedence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-locator-override-'));
  const home = join(root, 'home');
  const custom = binaryPath(join(root, 'custom'), 'brain');
  const overrides = join(home, '.agent-control', 'tool-paths.json');
  const endpointConfig = join(home, '.agent-control', 'config.json');
  try {
    await executable(custom);
    await mkdir(join(home, '.agent-control'), { recursive: true });
    await writeFile(endpointConfig, '{"endpoint":"unchanged"}\n');
    const first = new ToolLocator({ homeDir: home, overridesPath: overrides });
    await first.setOverride('brain', custom);
    if (process.platform !== 'win32') assert.equal((await stat(overrides)).mode & 0o777, 0o600);
    assert.equal((await readFile(endpointConfig, 'utf8')), '{"endpoint":"unchanged"}\n');

    const reloaded = new ToolLocator({ homeDir: home, overridesPath: overrides });
    assert.equal(reloaded.resolve('brain'), await realpath(custom));
    assert.equal(reloaded.status().find((tool) => tool.name === 'brain')?.source, 'override');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects non-executable overrides and never falls back from a stale saved override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-locator-invalid-override-'));
  const home = join(root, 'home');
  const candidate = join(root, 'non-executable');
  const overrides = join(home, '.agent-control', 'tool-paths.json');
  try {
    await mkdir(join(root, 'bin'), { recursive: true });
    await executable(join(root, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg'));
    await writeFile(candidate, 'not executable');
    const locator = new ToolLocator({
      homeDir: home,
      bundledDirs: [],
      homebrewDirs: [],
      loginShellPathDirs: [],
      inheritedPathDirs: [join(root, 'bin')],
      overridesPath: overrides,
    });
    await assert.rejects(locator.setOverride('rg', candidate));
    assert.equal(locator.status().find((tool) => tool.name === 'rg')?.overridden, false);
    await mkdir(join(home, '.agent-control'), { recursive: true });
    await writeFile(overrides, JSON.stringify({ schemaVersion: 1, overrides: { rg: candidate } }));

    const reloaded = new ToolLocator({
      homeDir: home,
      bundledDirs: [],
      homebrewDirs: [],
      loginShellPathDirs: [],
      inheritedPathDirs: [join(root, 'bin')],
      overridesPath: overrides,
    });
    assert.equal(reloaded.status().find((tool) => tool.name === 'rg')?.available, false);
    assert.throws(() => reloaded.resolve('rg'), ToolDependencyError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing tools throw a typed dependency error instead of masquerading as empty output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-locator-missing-'));
  try {
    const locator = new ToolLocator({
      homeDir: root,
      bundledDirs: [],
      homebrewDirs: [],
      loginShellPathDirs: [],
      inheritedPathDirs: [],
      overridesPath: join(root, 'tool-paths.json'),
    });
    assert.throws(() => locator.resolve('rg'), (error: unknown) => {
      assert.ok(error instanceof ToolDependencyError);
      assert.equal(error.code, 'TOOL_NOT_FOUND');
      assert.equal(error.tool, 'rg');
      assert.doesNotMatch(error.message, /No results found/);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('login-shell path parser accepts only absolute non-empty directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-locator-path-'));
  try {
    assert.deepEqual(
      parseLoginShellPath(`shell startup output\n__AGENT_CONTROL_LOGIN_PATH__${join(root, 'bin')}${delimiter}relative${delimiter}${join(root, 'other')}\n`),
      [join(root, 'bin'), join(root, 'other')],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('login-shell discovery passes only a minimal environment, excluding session and provider secrets', () => {
  const environment = createLoginShellEnvironment('/bin/zsh', {
    HOME: '/home/test', PATH: '/usr/bin', AC_DESKTOP_TOKEN: 'do-not-pass', OPENAI_API_KEY: 'do-not-pass',
  });
  assert.equal(environment.SHELL, '/bin/zsh');
  assert.equal(environment.HOME, '/home/test');
  assert.equal(environment.PATH, '/usr/bin');
  assert.equal(environment.AC_DESKTOP_TOKEN, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
});
