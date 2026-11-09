import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

export const SUITE_COMPONENT_IDS = [
  'agent-control',
  'agent-brain',
  'agent-workspace',
  'agent-skills',
  'agent-secure',
] as const;

export const SUITE_BUNDLED_COMPONENT_IDS = [
  'agent-control',
  'agent-workspace',
  'agent-skills',
  'agent-secure',
] as const;

export const SUITE_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'windows-arm64',
  'windows-x64',
] as const;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KEY_ID = /^agent-suite-release-[0-9]{4}(?:-[1-9][0-9]*)?$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ARTIFACT_NAME = /^[a-z0-9][a-z0-9.-]{0,159}$/;

export type SuiteComponentId = (typeof SUITE_COMPONENT_IDS)[number];
export type SuiteArtifactComponentId = Exclude<SuiteComponentId, 'agent-brain'>;
export type SuitePlatform = (typeof SUITE_PLATFORMS)[number];
export type SuitePrivateKey = KeyObject | string | Buffer;
export type SuitePublicKey = KeyObject | string | Buffer;

export interface SuiteArtifactComponent {
  id: SuiteArtifactComponentId;
  delivery: 'artifact';
  version: string;
  artifact_name: string;
  sha256: string;
}

export interface SuiteServiceComponent {
  id: 'agent-brain';
  delivery: 'service';
  version: string;
  service_contract: 'agent-brain-profile-v1';
}

export type SuiteLockComponent = SuiteArtifactComponent | SuiteServiceComponent;

export interface SuiteLockDraft {
  schema_version: 1;
  suite_version: string;
  platform: SuitePlatform;
  components: SuiteLockComponent[];
}

export interface SuitePrivacyGate {
  scanner: 'agent-secure';
  scanner_version: string;
  policy_sha256: string;
  attestation_sha256: string;
  coverage: 'git-visible-working-files-only';
  checks: Array<{ scanner: 'gitleaks' | 'osv-scanner'; tool_sha256: string }>;
  verdict: 'pass';
}

export interface SuiteLicenseGate {
  distribution_scope: 'private-internal' | 'external';
  notices_included: true;
  attribution_approved: true;
}

export interface SuiteLockPayload extends SuiteLockDraft {
  privacy_gate: SuitePrivacyGate;
  license_gate: SuiteLicenseGate;
}

export interface SuiteLock extends SuiteLockPayload {
  signature: {
    algorithm: 'Ed25519';
    key_id: string;
    value: string;
  };
}

export type TrustedSuiteKeys = ReadonlyMap<string, SuitePublicKey>;

/** Sign release metadata only when an Agent-Secure report is a complete pass with no findings. */
export function signSuiteLockDraft(
  draft: unknown,
  keyId: string,
  privateKeyInput: SuitePrivateKey,
  privacyReport: unknown,
  scannerVersion: string,
  licenseReview: unknown,
): SuiteLock {
  if (!KEY_ID.test(keyId)) throw new Error('Invalid suite release key ID.');
  const validatedDraft = validateSuiteLockDraft(draft);
  const privacyGate = validateAgentSecureReport(privacyReport, validatedDraft, scannerVersion);
  const licenseGate = validateSuiteLicenseReview(licenseReview);
  const payload: SuiteLockPayload = { ...validatedDraft, privacy_gate: privacyGate, license_gate: licenseGate };
  const privateKey = typeof privateKeyInput === 'string' || Buffer.isBuffer(privateKeyInput)
    ? createPrivateKey(privateKeyInput)
    : privateKeyInput;
  if (privateKey.asymmetricKeyType !== 'ed25519' || privateKey.type !== 'private') {
    throw new Error('Suite lock signing requires an Ed25519 private key.');
  }
  const signature = sign(null, Buffer.from(canonicalSuitePayload(payload)), privateKey).toString('base64');
  return { ...payload, signature: { algorithm: 'Ed25519', key_id: keyId, value: signature } };
}

/** Read an Ed25519 signing key only from a regular file with owner-only POSIX permissions. */
export async function readOwnerOnlySuitePrivateKey(path: string): Promise<KeyObject> {
  if (process.platform === 'win32' || !constants.O_NOFOLLOW) {
    throw new Error('Suite signing keys must be read on a host that can enforce owner-only file permissions.');
  }
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error('Suite signing key file is unavailable.');
  }
  let info;
  try {
    info = await handle.stat();
  } catch {
    await handle.close().catch(() => undefined);
    throw new Error('Suite signing key could not be read.');
  }
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    await handle.close().catch(() => undefined);
    throw new Error('Suite signing key must be a regular owner-only file.');
  }
  try {
    const key = createPrivateKey(await handle.readFile());
    if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'private') {
      throw new Error('Suite signing requires an Ed25519 private key.');
    }
    return key;
  } catch {
    throw new Error('Suite signing key could not be read.');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Verify strict lock fields, trusted key, signature, and target platform before staging artifacts. */
export function verifySuiteLock(input: unknown, trustedKeys: TrustedSuiteKeys, expectedPlatform: string): SuiteLock {
  const record = requireRecord(input, 'Suite lock');
  exactKeys(record, ['schema_version', 'suite_version', 'platform', 'components', 'privacy_gate', 'license_gate', 'signature'], 'Suite lock');
  const { signature: rawSignature, privacy_gate: rawPrivacyGate, license_gate: rawLicenseGate, ...rawDraft } = record;
  const draft = validateSuiteLockDraft(rawDraft);
  if (draft.platform !== expectedPlatform) throw new Error('Suite lock platform does not match the requested target.');
  const privacyGate = validatePrivacyGate(rawPrivacyGate, draft);
  const licenseGate = validateSuiteLicenseReview(rawLicenseGate);
  const payload: SuiteLockPayload = { ...draft, privacy_gate: privacyGate, license_gate: licenseGate };

  const signature = requireRecord(rawSignature, 'Suite lock signature');
  exactKeys(signature, ['algorithm', 'key_id', 'value'], 'Suite lock signature');
  if (signature.algorithm !== 'Ed25519' || typeof signature.key_id !== 'string' || !KEY_ID.test(signature.key_id)) {
    throw new Error('Suite lock signature metadata is invalid.');
  }
  if (typeof signature.value !== 'string') throw new Error('Suite lock signature is missing.');
  const signatureBytes = Buffer.from(signature.value, 'base64');
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature.value) {
    throw new Error('Suite lock signature encoding is invalid.');
  }
  const trustedKey = trustedKeys.get(signature.key_id);
  if (!trustedKey) throw new Error('Suite lock signing key is not trusted.');
  const publicKey = typeof trustedKey === 'string' || Buffer.isBuffer(trustedKey)
    ? createPublicKey(trustedKey)
    : trustedKey;
  if (publicKey.asymmetricKeyType !== 'ed25519' || publicKey.type !== 'public') {
    throw new Error('Suite lock trust anchor must be an Ed25519 public key.');
  }
  if (!verify(null, Buffer.from(canonicalSuitePayload(payload)), publicKey, signatureBytes)) {
    throw new Error('Suite lock signature verification failed.');
  }
  return { ...payload, signature: { algorithm: 'Ed25519', key_id: signature.key_id, value: signature.value } };
}

/** Canonical JSON bytes signed by the release key. */
export function canonicalSuitePayload(value: SuiteLockPayload): string {
  return JSON.stringify(sortObjectKeys(value));
}

export function validateSuiteLockDraft(input: unknown): SuiteLockDraft {
  const record = requireRecord(input, 'Suite lock payload');
  exactKeys(record, ['schema_version', 'suite_version', 'platform', 'components'], 'Suite lock payload');
  if (record.schema_version !== 1) throw new Error('Unsupported suite lock schema version.');
  if (typeof record.suite_version !== 'string' || !SEMVER.test(record.suite_version)) {
    throw new Error('Suite version must be semantic versioning.');
  }
  if (typeof record.platform !== 'string' || !SUITE_PLATFORMS.includes(record.platform as SuitePlatform)) {
    throw new Error('Suite target platform is not supported.');
  }
  if (!Array.isArray(record.components) || record.components.length !== SUITE_COMPONENT_IDS.length) {
    throw new Error('Suite lock must contain exactly the five supported components.');
  }

  const components = record.components.map((item, index): SuiteLockComponent => {
    const component = requireRecord(item, 'Suite component');
    const expectedId = SUITE_COMPONENT_IDS[index];
    if (component.id !== expectedId) throw new Error('Suite components must appear once in canonical order.');
    if (typeof component.version !== 'string' || !SEMVER.test(component.version)) {
      throw new Error('Component version must be semantic versioning.');
    }
    if (expectedId === 'agent-brain') {
      exactKeys(component, ['id', 'delivery', 'version', 'service_contract'], 'Brain service component');
      if (component.delivery !== 'service' || component.service_contract !== 'agent-brain-profile-v1') {
        throw new Error('Agent-Brain must be declared as the supported external inference service.');
      }
      return { id: 'agent-brain', delivery: 'service', version: component.version, service_contract: 'agent-brain-profile-v1' };
    }
    exactKeys(component, ['id', 'delivery', 'version', 'artifact_name', 'sha256'], 'Suite artifact component');
    if (component.delivery !== 'artifact') throw new Error('Bundled suite components must declare artifact delivery.');
    if (typeof component.artifact_name !== 'string' || !safeArtifactName(component.artifact_name, expectedId, record.platform as SuitePlatform)) {
      throw new Error('Component artifact name is invalid or does not identify the component and platform.');
    }
    if (typeof component.sha256 !== 'string' || !SHA256.test(component.sha256)) {
      throw new Error('Component artifact must have a SHA-256 digest.');
    }
    return {
      id: expectedId,
      delivery: 'artifact',
      version: component.version,
      artifact_name: component.artifact_name,
      sha256: component.sha256,
    };
  });

  return {
    schema_version: 1,
    suite_version: record.suite_version,
    platform: record.platform as SuitePlatform,
    components,
  };
}

function validateAgentSecureReport(reportInput: unknown, draft: SuiteLockDraft, scannerVersion: string): SuitePrivacyGate {
  if (!SEMVER.test(scannerVersion)) throw new Error('Agent-Secure scanner version must be semantic versioning.');
  const secureComponent = draft.components.find((component) => component.id === 'agent-secure');
  if (!secureComponent || secureComponent.version !== scannerVersion) {
    throw new Error('Privacy scanner version must match the bundled Agent-Secure component.');
  }
  const report = requireRecord(reportInput, 'Agent-Secure report');
  const keys = ['version', 'root', 'policy_sha256', 'created', 'status', 'coverage', 'checks', 'findings'];
  const allowedKeys = [...keys, 'allowed'];
  const actual = Object.keys(report).sort();
  if (actual.some((key) => !allowedKeys.includes(key)) || keys.some((key) => !(key in report))) {
    throw new Error('Agent-Secure report has an unsupported schema.');
  }
  if (report.version !== 1 || report.status !== 'pass' || typeof report.root !== 'string'
    || report.root.length === 0 || typeof report.created !== 'string' || Number.isNaN(Date.parse(report.created))
    || typeof report.coverage !== 'string' || !report.coverage.includes('Git-visible working files only')
    || typeof report.policy_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(report.policy_sha256)
    || !Array.isArray(report.findings) || report.findings.length !== 0
    || (report.allowed !== undefined && (!Array.isArray(report.allowed) || report.allowed.length !== 0))) {
    throw new Error('Suite privacy gate requires a complete Agent-Secure pass with no findings or exceptions.');
  }
  if (!Array.isArray(report.checks)) throw new Error('Suite privacy gate report checks are invalid.');
  const checkScanners = new Set<string>();
  for (const rawCheck of report.checks) {
    const check = requireRecord(rawCheck, 'Agent-Secure check');
    const checkKeys = ['scanner', 'status', 'detail', 'tool_sha256'];
    if (Object.keys(check).some((key) => !checkKeys.includes(key))
      || (check.scanner !== 'gitleaks' && check.scanner !== 'osv-scanner') || check.status !== 'pass'
      || (check.tool_sha256 !== undefined && (typeof check.tool_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(check.tool_sha256)))) {
      throw new Error('Suite privacy gate contains an incomplete scanner check.');
    }
    if (typeof check.tool_sha256 !== 'string' || (check.detail !== undefined && typeof check.detail !== 'string')) {
      throw new Error('Suite privacy gate report is missing a pinned scanner digest.');
    }
    if (checkScanners.has(check.scanner)) throw new Error('Suite privacy gate contains duplicate scanner checks.');
    checkScanners.add(check.scanner);
  }
  if (checkScanners.size !== 2 || !checkScanners.has('gitleaks') || !checkScanners.has('osv-scanner')) {
    throw new Error('Suite privacy gate must pass both secret and dependency scanners.');
  }
  const checks = report.checks.map((check) => ({
    scanner: check.scanner as 'gitleaks' | 'osv-scanner',
    tool_sha256: check.tool_sha256 as string,
  })).sort((left, right) => left.scanner < right.scanner ? -1 : left.scanner > right.scanner ? 1 : 0);
  const sanitizedAttestation = {
    version: 1,
    status: 'pass',
    coverage: 'git-visible-working-files-only',
    policy_sha256: report.policy_sha256,
    checks,
    findings: 0,
    allowed: 0,
  };
  const attestationSha256 = createHash('sha256').update(canonicalJson(sanitizedAttestation)).digest('hex');
  return {
    scanner: 'agent-secure',
    scanner_version: scannerVersion,
    policy_sha256: `sha256:${report.policy_sha256}`,
    attestation_sha256: `sha256:${attestationSha256}`,
    coverage: 'git-visible-working-files-only',
    checks,
    verdict: 'pass',
  };
}

function validatePrivacyGate(value: unknown, draft: SuiteLockDraft): SuitePrivacyGate {
  const gate = requireRecord(value, 'Suite privacy gate');
  exactKeys(gate, ['scanner', 'scanner_version', 'policy_sha256', 'attestation_sha256', 'coverage', 'checks', 'verdict'], 'Suite privacy gate');
  const secureComponent = draft.components.find((component) => component.id === 'agent-secure');
  if (gate.scanner !== 'agent-secure' || gate.verdict !== 'pass'
    || typeof gate.scanner_version !== 'string' || !SEMVER.test(gate.scanner_version)
    || gate.scanner_version !== secureComponent?.version
    || typeof gate.policy_sha256 !== 'string' || !SHA256.test(gate.policy_sha256)
    || typeof gate.attestation_sha256 !== 'string' || !SHA256.test(gate.attestation_sha256)
    || gate.coverage !== 'git-visible-working-files-only' || !Array.isArray(gate.checks) || gate.checks.length !== 2) {
    throw new Error('Suite lock requires a passing Agent-Secure privacy attestation for its Secure release.');
  }
  const checks: SuitePrivacyGate['checks'] = gate.checks.map((item) => {
    const check = requireRecord(item, 'Suite privacy check');
    exactKeys(check, ['scanner', 'tool_sha256'], 'Suite privacy check');
    if ((check.scanner !== 'gitleaks' && check.scanner !== 'osv-scanner')
      || typeof check.tool_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(check.tool_sha256)) {
      throw new Error('Suite lock privacy check is invalid.');
    }
    return {
      scanner: check.scanner as 'gitleaks' | 'osv-scanner',
      tool_sha256: check.tool_sha256,
    };
  });
  if (checks[0]?.scanner !== 'gitleaks' || checks[1]?.scanner !== 'osv-scanner') {
    throw new Error('Suite lock privacy checks must cover the pinned secret and dependency scanners.');
  }
  return {
    scanner: 'agent-secure',
    scanner_version: gate.scanner_version,
    policy_sha256: gate.policy_sha256,
    attestation_sha256: gate.attestation_sha256,
    coverage: 'git-visible-working-files-only',
    checks,
    verdict: 'pass',
  };
}

function validateSuiteLicenseReview(value: unknown): SuiteLicenseGate {
  const review = requireRecord(value, 'Suite license review');
  exactKeys(review, ['distribution_scope', 'notices_included', 'attribution_approved'], 'Suite license review');
  if ((review.distribution_scope !== 'private-internal' && review.distribution_scope !== 'external')
    || review.notices_included !== true || review.attribution_approved !== true) {
    throw new Error('Suite lock requires explicit approved license/attribution review and included notices.');
  }
  return {
    distribution_scope: review.distribution_scope,
    notices_included: true,
    attribution_approved: true,
  };
}

export function safeArtifactName(name: string, id: SuiteArtifactComponentId, platform: SuitePlatform): boolean {
  const prefix = `${id}-${platform}`;
  const extension = name.slice(prefix.length);
  return ARTIFACT_NAME.test(name)
    && name.startsWith(prefix)
    && ['.tar.gz', '.zip'].includes(extension);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, allowed: string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, sortObjectKeys(child)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}
