import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectRoot, 'src-tauri/target/desktop-host');
const bundlePath = resolve(outputDir, 'server.cjs');
const configPath = resolve(outputDir, 'sea-config.json');
const blobPath = resolve(outputDir, 'sea-prep.blob');
const executablePath = resolve(outputDir, 'agent-control-host');

assertBuildEnvironment();
mkdirSync(outputDir, { recursive: true });
rmSync(executablePath, { force: true });
rmSync(blobPath, { force: true });

await build({
  entryPoints: [resolve(projectRoot, 'server/index.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: { 'import.meta.dirname': '__dirname' },
  sourcemap: false,
});

const seaConfig = {
  main: bundlePath,
  output: Number(process.versions.node.split('.')[0]) >= 26 ? executablePath : blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgvExtension: 'none',
};

if (Number(process.versions.node.split('.')[0]) >= 26) {
  seaConfig.mainFormat = 'commonjs';
  seaConfig.executable = process.execPath;
  writeFileSync(configPath, `${JSON.stringify(seaConfig, null, 2)}\n`);
  execFileSync(process.execPath, ['--build-sea', configPath], { cwd: projectRoot, stdio: 'inherit' });
} else {
  writeFileSync(configPath, `${JSON.stringify(seaConfig, null, 2)}\n`);
  execFileSync(process.execPath, ['--experimental-sea-config', configPath], { cwd: projectRoot, stdio: 'inherit' });
  copyFileSync(process.execPath, executablePath);
  execFileSync('codesign', ['--remove-signature', executablePath], { cwd: projectRoot, stdio: 'inherit' });
  execFileSync('pnpm', [
    'exec', 'postject', executablePath, 'NODE_SEA_BLOB', blobPath,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--macho-segment-name', 'NODE_SEA',
  ], { cwd: projectRoot, stdio: 'ignore' });
}

chmodSync(executablePath, 0o755);
execFileSync('codesign', ['--sign', '-', executablePath], { cwd: projectRoot, stdio: 'inherit' });
console.log(`Built standalone host with Node ${process.versions.node}: ${executablePath}`);

function assertBuildEnvironment() {
  if (process.platform !== 'darwin') {
    throw new Error('The desktop host packaging build currently supports macOS only.');
  }
  const targetPlatform = process.env.TAURI_ENV_PLATFORM;
  if (targetPlatform && targetPlatform !== 'darwin') {
    throw new Error('The desktop host must be built for the native macOS target.');
  }
  const targetArch = process.env.TAURI_ENV_ARCH;
  const nodeArch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
  if (targetArch && targetArch !== nodeArch) {
    throw new Error('Cross-architecture desktop host builds are not supported.');
  }
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const minimums = new Map([[22, [23, 4]], [24, [22, 1]], [26, [12, 1]]]);
  const minimum = minimums.get(major);
  if (!minimum || minor < minimum[0] || (minor === minimum[0] && patch < minimum[1])) {
    throw new Error('Use a Node version allowed by package.json to build the desktop host.');
  }
}
