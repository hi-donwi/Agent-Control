import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { createSuiteLockDraft, type SuiteLockMetadata } from '../scripts/suite-draft.js';
import { assembleSuiteBundle } from '../scripts/assemble-suite.js';
import { readOwnerOnlySuitePrivateKey, signSuiteLockDraft, SUITE_BUNDLED_COMPONENT_IDS, SUITE_COMPONENT_IDS, type SuiteLockDraft } from '../scripts/suite-lock.js';

const PLATFORM = 'darwin-arm64';
const execFileAsync = promisify(execFile);
const releaseReport = () => ({
  version: 1,
  root: '/private/release/source-tree',
  policy_sha256: 'b'.repeat(64),
  created: '2026-11-08T00:00:00Z',
  status: 'pass',
  coverage: 'Git-visible working files only.',
  checks: [
    { scanner: 'gitleaks', status: 'pass', detail: '/private/release/source-tree scanner details', tool_sha256: 'd'.repeat(64) },
    { scanner: 'osv-scanner', status: 'pass', tool_sha256: 'e'.repeat(64) },
  ],
  findings: [],
});
const licenseReview = () => ({
  distribution_scope: 'private-internal',
  notices_included: true,
  attribution_approved: true,
});

function suiteMetadata(): SuiteLockMetadata {
  return {
    schema_version: 1,
    suite_version: '1.0.0',
    platform: PLATFORM,
    components: SUITE_COMPONENT_IDS.map((id) => id === 'agent-brain'
      ? { id, delivery: 'service' as const, version: '1.1.0', service_contract: 'agent-brain-profile-v1' as const }
      : { id, delivery: 'artifact' as const, version: id === 'agent-secure' ? '0.1.6' : '1.2.3', artifact_name: `${id}-${PLATFORM}.tar.gz` }),
  };
}

async function writeSuiteArtifacts(directory: string, metadata: SuiteLockMetadata): Promise<void> {
  for (const component of metadata.components) {
    if (component.delivery === 'artifact') {
      await writeFile(join(directory, component.artifact_name), `public-artifact:${component.id}`);
    }
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'suite-package-'));
  const artifactsDirectory = join(root, 'artifacts');
  const outputParent = join(root, 'output');
  await mkdir(artifactsDirectory);
  await mkdir(outputParent);
  const keys = generateKeyPairSync('ed25519');
  const metadata = suiteMetadata();
  await writeSuiteArtifacts(artifactsDirectory, metadata);
  const draft: SuiteLockDraft = await createSuiteLockDraft(metadata, artifactsDirectory);
  const lock = signSuiteLockDraft(draft, 'agent-suite-release-2099', keys.privateKey, releaseReport(), '0.1.6', licenseReview());
  const lockPath = join(root, 'suite.lock.json');
  await writeFile(lockPath, JSON.stringify(lock));
  return {
    root,
    artifactsDirectory,
    outputDirectory: join(outputParent, 'Agent-Workspace-Suite'),
    lockPath,
    lock,
    publicKeys: new Map([['agent-suite-release-2099', keys.publicKey]]),
  };
}

test('assembler locks five components but copies only the four bundled artifacts', async () => {
  const f = await fixture();
  try {
    await assembleSuiteBundle({
      lock: f.lock,
      artifactsDirectory: f.artifactsDirectory,
      outputDirectory: f.outputDirectory,
      trustedKeys: f.publicKeys,
      platform: PLATFORM,
    });
    const componentDirs = await readdir(join(f.outputDirectory, 'components'));
    assert.deepEqual(componentDirs.sort(), [...SUITE_BUNDLED_COMPONENT_IDS].sort());
    assert.deepEqual(f.lock.components.find((component) => component.id === 'agent-brain'), {
      id: 'agent-brain', delivery: 'service', version: '1.1.0', service_contract: 'agent-brain-profile-v1',
    });
    for (const component of f.lock.components.filter((item) => item.delivery === 'artifact')) {
      assert.equal(
        await readFile(join(f.outputDirectory, 'components', component.id, component.artifact_name), 'utf8'),
        `public-artifact:${component.id}`,
      );
    }
    const packagedLock = JSON.parse(await readFile(join(f.outputDirectory, 'suite.lock.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(packagedLock).sort(), ['components', 'license_gate', 'platform', 'privacy_gate', 'schema_version', 'signature', 'suite_version']);
    assert.equal(JSON.stringify(packagedLock).includes(f.root), false);
    assert.equal(JSON.stringify(packagedLock).includes('/private/release/source-tree'), false);
    assert.equal(JSON.stringify(packagedLock).includes('scanner details'), false);
    assert.equal(JSON.stringify(packagedLock).includes('created'), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('assembler rejects a tampered lock and leaves no output package', async () => {
  const f = await fixture();
  try {
    const tampered = { ...f.lock, suite_version: '9.9.9' };
    await assert.rejects(assembleSuiteBundle({
      lock: tampered,
      artifactsDirectory: f.artifactsDirectory,
      outputDirectory: f.outputDirectory,
      trustedKeys: f.publicKeys,
      platform: PLATFORM,
    }), /signature|lock/i);
    await assert.rejects(readFile(f.outputDirectory));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('assembler refuses unlisted files rather than copying workspace or private data', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.artifactsDirectory, 'private-data.txt'), 'do not package');
    await assert.rejects(assembleSuiteBundle({
      lock: f.lock,
      artifactsDirectory: f.artifactsDirectory,
      outputDirectory: f.outputDirectory,
      trustedKeys: f.publicKeys,
      platform: PLATFORM,
    }), /unexpected.*artifact|staging/i);
    await assert.rejects(readFile(f.outputDirectory));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('assembler rejects artifact bytes that do not match the signed digest', async () => {
  const f = await fixture();
  try {
    const artifact = f.lock.components.find((item) => item.delivery === 'artifact')!;
    await writeFile(join(f.artifactsDirectory, artifact.artifact_name), 'modified-release');
    await assert.rejects(assembleSuiteBundle({
      lock: f.lock,
      artifactsDirectory: f.artifactsDirectory,
      outputDirectory: f.outputDirectory,
      trustedKeys: f.publicKeys,
      platform: PLATFORM,
    }), /SHA-256/);
    await assert.rejects(readFile(f.outputDirectory));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('assembler refuses symlinked inputs and never overwrites an existing output directory', async () => {
  const f = await fixture();
  try {
    const artifact = f.lock.components.find((item) => item.delivery === 'artifact')!.artifact_name;
    const artifactPath = join(f.artifactsDirectory, artifact);
    const externalFile = join(f.root, 'outside-artifact.bin');
    await writeFile(externalFile, 'unlisted source');
    await unlink(artifactPath);
    await symlink(externalFile, artifactPath);
    await assert.rejects(assembleSuiteBundle({
      lock: f.lock,
      artifactsDirectory: f.artifactsDirectory,
      outputDirectory: f.outputDirectory,
      trustedKeys: f.publicKeys,
      platform: PLATFORM,
    }), /exactly the 4 files/);

    await unlink(artifactPath);
    await writeFile(artifactPath, 'public-artifact:agent-control');
    await mkdir(f.outputDirectory);
    const sentinel = join(f.outputDirectory, 'keep.txt');
    await writeFile(sentinel, 'preserve');
    await assert.rejects(assembleSuiteBundle({
      lock: f.lock,
      artifactsDirectory: f.artifactsDirectory,
      outputDirectory: f.outputDirectory,
      trustedKeys: f.publicKeys,
      platform: PLATFORM,
    }), /new directory/);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('signer rejects pathful artifact names and unsupported component sets', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const metadata = suiteMetadata();
  const base: SuiteLockDraft = {
    ...metadata,
    components: metadata.components.map((item) => item.delivery === 'service'
      ? item
      : { ...item, sha256: `sha256:${'a'.repeat(64)}` }),
  };
  const pathful = structuredClone(base);
  const firstArtifact = pathful.components.find((component) => component.delivery === 'artifact')!;
  firstArtifact.artifact_name = '../private.tar.gz';
  assert.throws(() => signSuiteLockDraft(pathful, 'agent-suite-release-2099', privateKey, releaseReport(), '0.1.6', licenseReview()), /artifact|path/i);
  const missing = { ...base, components: base.components.slice(1) };
  assert.throws(() => signSuiteLockDraft(missing, 'agent-suite-release-2099', privateKey, releaseReport(), '0.1.6', licenseReview()), /component/i);
  const personalMetadata = { ...base, repository_url: 'https://example.invalid/source' };
  assert.throws(() => signSuiteLockDraft(personalMetadata, 'agent-suite-release-2099', privateKey, releaseReport(), '0.1.6', licenseReview()), /fields/i);
  const failedReport = { ...releaseReport(), status: 'findings' };
  assert.throws(() => signSuiteLockDraft(base, 'agent-suite-release-2099', privateKey, failedReport, '0.1.6', licenseReview()), /privacy gate/i);
  const reportWithException = { ...releaseReport(), allowed: [{ id: 'exception' }] };
  assert.throws(() => signSuiteLockDraft(base, 'agent-suite-release-2099', privateKey, reportWithException, '0.1.6', licenseReview()), /privacy gate/i);
  const incompleteReport = { ...releaseReport(), checks: [{ scanner: 'gitleaks', status: 'pass', tool_sha256: 'd'.repeat(64) }] };
  assert.throws(() => signSuiteLockDraft(base, 'agent-suite-release-2099', privateKey, incompleteReport, '0.1.6', licenseReview()), /privacy gate/i);
  assert.throws(() => signSuiteLockDraft(base, 'agent-suite-release-2099', privateKey, releaseReport(), '0.1.6', { ...licenseReview(), attribution_approved: false }), /license\/attribution review/i);
});

test('private signing keys must be owner-only regular files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-key-'));
  try {
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyPath = join(root, 'release-key.pem');
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await chmod(privateKeyPath, 0o600);
    const key = await readOwnerOnlySuitePrivateKey(privateKeyPath);
    assert.equal(key.asymmetricKeyType, 'ed25519');
    await chmod(privateKeyPath, 0o644);
    await assert.rejects(readOwnerOnlySuitePrivateKey(privateKeyPath), /owner-only/);
    const linkedKey = join(root, 'linked-release-key.pem');
    await symlink(privateKeyPath, linkedKey);
    await assert.rejects(readOwnerOnlySuitePrivateKey(linkedKey), /unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('suite lock schema has no repository, path, project, or personal metadata fields', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/suite-lock.schema.json', import.meta.url), 'utf8')) as {
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    $defs: {
      component: { additionalProperties: boolean; properties: Record<string, unknown> };
      'brain-service': { additionalProperties: boolean; properties: Record<string, unknown> };
      privacy_gate: { additionalProperties: boolean; properties: Record<string, unknown> };
      license_gate: { additionalProperties: boolean; properties: Record<string, unknown> };
    };
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['components', 'license_gate', 'platform', 'privacy_gate', 'schema_version', 'signature', 'suite_version']);
  assert.equal(schema.$defs.component.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.$defs.component.properties).sort(), ['artifact_name', 'delivery', 'id', 'sha256', 'version']);
  assert.equal(schema.$defs['brain-service'].additionalProperties, false);
  assert.deepEqual(Object.keys(schema.$defs['brain-service'].properties).sort(), ['delivery', 'id', 'service_contract', 'version']);
  assert.equal(schema.$defs.privacy_gate.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.$defs.privacy_gate.properties).sort(), ['attestation_sha256', 'checks', 'coverage', 'policy_sha256', 'scanner', 'scanner_version', 'verdict']);
  assert.equal(schema.$defs.license_gate.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.$defs.license_gate.properties).sort(), ['attribution_approved', 'distribution_scope', 'notices_included']);
});

test('draft metadata schema accepts only component versions and artifact basenames', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/suite-lock-draft.schema.json', import.meta.url), 'utf8')) as {
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    $defs: { component: { properties: Record<string, unknown> }; 'agent-brain-service': { properties: Record<string, unknown> } };
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['components', 'platform', 'schema_version', 'suite_version']);
  assert.deepEqual(Object.keys(schema.$defs.component.properties).sort(), ['artifact_name', 'delivery', 'id', 'version']);
  assert.deepEqual(Object.keys(schema.$defs['agent-brain-service'].properties).sort(), ['delivery', 'id', 'service_contract', 'version']);
});

test('draft generator hashes the exact release allowlist without serializing staging paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-draft-'));
  try {
    const artifactsDirectory = join(root, 'artifacts');
    await mkdir(artifactsDirectory);
    const metadata = suiteMetadata();
    await writeSuiteArtifacts(artifactsDirectory, metadata);
    const draft = await createSuiteLockDraft(metadata, artifactsDirectory);
    assert.equal(draft.components.length, 5);
    assert.equal(draft.components.filter((component) => component.delivery === 'artifact').length, 4);
    assert.ok(draft.components.filter((component) => component.delivery === 'artifact')
      .every((component) => /^sha256:[a-f0-9]{64}$/.test(component.sha256)));
    assert.deepEqual(draft.components.find((component) => component.id === 'agent-brain'), {
      id: 'agent-brain', delivery: 'service', version: '1.1.0', service_contract: 'agent-brain-profile-v1',
    });
    assert.equal(JSON.stringify(draft).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('draft generator rejects extra files and pathful metadata before writing a lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-draft-private-'));
  try {
    const artifactsDirectory = join(root, 'artifacts');
    await mkdir(artifactsDirectory);
    const metadata = suiteMetadata();
    await writeSuiteArtifacts(artifactsDirectory, metadata);
    await writeFile(join(artifactsDirectory, 'private-data.txt'), 'not a component artifact');
    await assert.rejects(createSuiteLockDraft(metadata, artifactsDirectory), /exactly the 4 files/);
    const pathful = { ...metadata, repository_url: 'https://example.invalid/source' };
    await assert.rejects(createSuiteLockDraft(pathful, artifactsDirectory), /unsupported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI signs and assembles without copying the scan report or echoing local paths', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-cli-'));
  try {
    const artifactsDirectory = join(root, 'artifacts');
    const outputParent = join(root, 'bundle-output');
    await mkdir(artifactsDirectory);
    await mkdir(outputParent);
    const keys = generateKeyPairSync('ed25519');
    const metadata = suiteMetadata();
    await writeSuiteArtifacts(artifactsDirectory, metadata);
    const draft = await createSuiteLockDraft(metadata, artifactsDirectory);
    const draftPath = join(root, 'draft.json');
    const reportPath = join(root, 'agent-secure-report.json');
    const licenseReviewPath = join(root, 'license-review.json');
    const privateKeyPath = join(root, 'suite-release.pem');
    const publicKeyPath = join(root, 'suite-release.pub.pem');
    const lockPath = join(root, 'suite.lock.json');
    await writeFile(draftPath, JSON.stringify(draft));
    await writeFile(reportPath, JSON.stringify(releaseReport()));
    await writeFile(licenseReviewPath, JSON.stringify(licenseReview()));
    await writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await chmod(privateKeyPath, 0o600);
    await writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    const cliPath = resolve('scripts/suite-package.ts');

    const signed = await execFileAsync(process.execPath, [
      '--import', 'tsx', cliPath, 'sign', '--draft', draftPath, '--privacy-report', reportPath,
      '--license-review', licenseReviewPath,
      '--secure-version', '0.1.6', '--private-key', privateKeyPath,
      '--key-id', 'agent-suite-release-2099', '--output', lockPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(signed.stderr, '');
    assert.equal(signed.stdout.includes(root), false);
    const signedLockText = await readFile(lockPath, 'utf8');
    assert.equal(signedLockText.includes('/private/release/source-tree'), false);
    assert.equal(signedLockText.includes('created'), false);

    const outputDirectory = join(outputParent, 'Agent-Workspace-Suite');
    const assembled = await execFileAsync(process.execPath, [
      '--import', 'tsx', cliPath, 'assemble', '--lock', lockPath, '--artifacts', artifactsDirectory,
      '--output', outputDirectory, '--platform', PLATFORM,
      '--trusted-key', `agent-suite-release-2099=${publicKeyPath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(assembled.stderr, '');
    assert.equal(assembled.stdout.includes(root), false);
    assert.deepEqual((await readdir(join(outputDirectory, 'components'))).sort(), [...SUITE_BUNDLED_COMPONENT_IDS].sort());
    assert.equal((await readdir(outputDirectory)).sort().join(','), 'components,suite.lock.json');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
