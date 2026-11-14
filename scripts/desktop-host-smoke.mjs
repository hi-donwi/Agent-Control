import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.argv.includes('--bundle')
  ? 'src-tauri/target/release/bundle/macos/Agent Control.app/Contents/Resources/agent-control-host'
  : 'src-tauri/target/desktop-host/agent-control-host';
const executable = resolve(projectRoot, process.env.AC_DESKTOP_HOST_PATH ?? executablePath);
try {
  await access(executable, constants.X_OK);
} catch {
  const command = process.argv.includes('--bundle')
    ? 'pnpm exec tauri build --bundles app'
    : 'pnpm run desktop:host:build';
  throw new Error(`Build the packaged host first with \`${command}\`.`);
}
const home = await mkdtemp(join(tmpdir(), 'agent-control-host-smoke-'));
await mkdir(join(home, '.agents', 'standards'), { recursive: true });
await writeFile(join(home, 'AGENTS.md'), '# Smoke-test workspace\n');
const baseEnv = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  AC_DESKTOP_MODE: '1',
  HOST: '127.0.0.1',
  NODE_ENV: 'production',
  HOME: home,
  USERPROFILE: home,
  WS_WORKSPACE_ROOT: home,
};
let child;

try {
  let started = await startHost(baseEnv, '0');
  child = started.child;
  const ready = started.ready;
  assert.deepEqual(Object.keys(ready).sort(), ['host', 'port', 'protocolVersion', 'token', 'type']);
  assert.equal(ready.type, 'agent-control-ready');
  assert.equal(ready.protocolVersion, 1);
  assert.equal(ready.host, '127.0.0.1');
  assert.ok(Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535);
  assert.match(ready.token, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(started.stderr(), new RegExp(ready.token));

  const endpoint = `http://${ready.host}:${ready.port}/api/agent/providers`;
  const origin = 'tauri://localhost';
  assert.equal((await fetch(endpoint, { headers: { Origin: origin } })).status, 401);
  assert.equal((await fetch(`${endpoint}?token=${ready.token}`, { headers: { Origin: origin } })).status, 401);
  assert.equal((await fetch(endpoint, {
    headers: { Origin: 'https://attacker.invalid', Authorization: `Bearer ${ready.token}` },
  })).status, 403);
  assert.equal((await fetch(endpoint, {
    headers: { Origin: origin, Authorization: `Bearer ${ready.token}` },
  })).status, 200);
  assert.equal((await fetch(`http://${ready.host}:${ready.port}/`)).status, 404);
  await stopGracefully(child);
  child = undefined;

  started = await startHost(baseEnv, String(ready.port), ready.token);
  child = started.child;
  assert.deepEqual(started.ready, ready, 'a supervised restart preserves loopback endpoint and session token');
  assert.doesNotMatch(started.stderr(), new RegExp(ready.token));
  await stopGracefully(child);
  child = undefined;
  console.log('[PASS] packaged host readiness, authentication, restart identity, and graceful shutdown');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  await rm(home, { recursive: true, force: true });
}

async function startHost(env, port, token) {
  const child = spawn(executable, [], {
    cwd: home,
    env: { ...env, PORT: port, ...(token ? { AC_DESKTOP_TOKEN: token } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const line = await readReadyLine(child, () => stderr);
    return { child, ready: JSON.parse(line), stderr: () => stderr };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolveExit) => child.once('exit', resolveExit));
    }
    throw error;
  }
}

async function stopGracefully(child) {
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.stdin.write('AC_DESKTOP_SHUTDOWN_V1\n');
  const result = await Promise.race([
    exited.then(() => 'exited'),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 4000)),
  ]);
  if (result === 'timeout') {
    child.kill();
    throw new Error('Packaged host failed graceful shutdown.');
  }
}

function readReadyLine(process, getStderr) {
  return new Promise((resolveLine, rejectLine) => {
    let output = '';
    const timeout = setTimeout(() => rejectLine(new Error('Host readiness timed out.')), 10_000);
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 4096) {
        clearTimeout(timeout);
        rejectLine(new Error('Host readiness exceeded 4096 bytes.'));
        return;
      }
      const newline = output.indexOf('\n');
      if (newline >= 0) {
        clearTimeout(timeout);
        resolveLine(output.slice(0, newline));
      }
    });
    process.once('error', (error) => {
      clearTimeout(timeout);
      rejectLine(error);
    });
    process.once('exit', (code, signal) => {
      clearTimeout(timeout);
      rejectLine(new Error(`Host exited before readiness (${code ?? signal}): ${getStderr()}`));
    });
  });
}
