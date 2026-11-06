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
const child = spawn(executable, [], {
  cwd: home,
  env: {
    ...process.env,
    AC_DESKTOP_MODE: '1',
    HOST: '127.0.0.1',
    PORT: '0',
    NODE_ENV: 'production',
    HOME: home,
    USERPROFILE: home,
    WS_WORKSPACE_ROOT: home,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });
const exited = new Promise((resolveExit) => {
  child.once('exit', resolveExit);
  child.once('error', resolveExit);
});

try {
  const line = await readReadyLine(child, () => stderr);
  const ready = JSON.parse(line);
  assert.deepEqual(Object.keys(ready).sort(), ['host', 'port', 'protocolVersion', 'token', 'type']);
  assert.equal(ready.type, 'agent-control-ready');
  assert.equal(ready.protocolVersion, 1);
  assert.equal(ready.host, '127.0.0.1');
  assert.ok(Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535);
  assert.match(ready.token, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(stderr, new RegExp(ready.token));

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
  console.log('[PASS] packaged host readiness and desktop authentication');
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exited;
  await rm(home, { recursive: true, force: true });
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
