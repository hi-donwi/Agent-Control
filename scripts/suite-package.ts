import { createPublicKey } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assembleSuiteBundle } from './assemble-suite.js';
import { createSuiteLockDraft } from './suite-draft.js';
import { readOwnerOnlySuitePrivateKey, signSuiteLockDraft, type TrustedSuiteKeys } from './suite-lock.js';

const MAX_LOCK_BYTES = 1024 * 1024;

async function main(args: string[]): Promise<void> {
  const [command, ...flags] = args;
  if (command === 'draft') {
    if (flags.includes('--help') || flags.includes('-h')) {
      console.log('suite:create-lock-draft -- --metadata RELEASE_METADATA.json --artifacts EXACTLY_FOUR_BUNDLED_ARTIFACTS_DIR --output DRAFT.json');
      return;
    }
    const { values } = parseArgs({
      args: flags,
      strict: true,
      allowPositionals: false,
      options: {
        metadata: { type: 'string' },
        artifacts: { type: 'string' },
        output: { type: 'string' },
      },
    });
    if (!values.metadata || !values.artifacts || !values.output) {
      throw new Error('Use draft --metadata FILE --artifacts DIR --output FILE.');
    }
    const metadata = await readJson(values.metadata);
    const draft = await createSuiteLockDraft(metadata, values.artifacts);
    try {
      await writeFile(values.output, `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    } catch {
      throw new Error('Lock draft output must be a new owner-only file in an existing directory.');
    }
    console.log(`Created unsigned suite lock draft ${draft.suite_version} for ${draft.platform}.`);
    return;
  }

  if (command === 'sign') {
    if (flags.includes('--help') || flags.includes('-h')) {
      console.log('suite:sign-lock -- --draft DRAFT.json --privacy-report AGENT_SECURE_REPORT.json --secure-version VERSION --license-review APPROVED_REVIEW.json --private-key OWNER_ONLY_KEY.pem --key-id agent-suite-release-YYYY --output suite.lock.json');
      return;
    }
    const { values } = parseArgs({
      args: flags,
      strict: true,
      allowPositionals: false,
      options: {
        draft: { type: 'string' },
        'privacy-report': { type: 'string' },
        'license-review': { type: 'string' },
        'private-key': { type: 'string' },
        'secure-version': { type: 'string' },
        'key-id': { type: 'string' },
        output: { type: 'string' },
      },
    });
    if (!values.draft || !values['privacy-report'] || !values['license-review'] || !values['private-key'] || !values['secure-version'] || !values['key-id'] || !values.output) {
      throw new Error('Use sign --draft FILE --privacy-report FILE --license-review FILE --secure-version VERSION --private-key FILE --key-id agent-suite-release-YYYY --output FILE.');
    }
    const draft = await readJson(values.draft);
    const privacyReport = await readJson(values['privacy-report']);
    const licenseReview = await readJson(values['license-review']);
    const privateKey = await readOwnerOnlySuitePrivateKey(values['private-key']);
    const lock = signSuiteLockDraft(draft, values['key-id'], privateKey, privacyReport, values['secure-version'], licenseReview);
    try {
      await writeFile(values.output, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    } catch {
      throw new Error('Signed suite lock output must be a new file in an existing directory.');
    }
    console.log(`Signed suite lock ${lock.suite_version} for ${lock.platform} with ${lock.signature.key_id}.`);
    return;
  }

  if (command === 'assemble') {
    if (flags.includes('--help') || flags.includes('-h')) {
      console.log('suite:assemble -- --lock suite.lock.json --artifacts FOUR_BUNDLED_ARTIFACT_FILES_DIR --output NEW_BUNDLE_DIR --platform TARGET --trusted-key agent-suite-release-YYYY=PUBLIC_KEY.pem');
      return;
    }
    const { values } = parseArgs({
      args: flags,
      strict: true,
      allowPositionals: false,
      options: {
        lock: { type: 'string' },
        artifacts: { type: 'string' },
        output: { type: 'string' },
        platform: { type: 'string' },
        'trusted-key': { type: 'string', multiple: true },
      },
    });
    if (!values.lock || !values.artifacts || !values.output || !values.platform || !values['trusted-key']?.length) {
      throw new Error('Use assemble --lock FILE --artifacts DIR --output DIR --platform TARGET --trusted-key ID=PUBLIC_KEY (repeatable).');
    }
    const trustedKeys: TrustedSuiteKeys = await readTrustedKeys(values['trusted-key']);
    const lock = await readJson(values.lock);
    const verified = await assembleSuiteBundle({
      lock,
      artifactsDirectory: values.artifacts,
      outputDirectory: values.output,
      trustedKeys,
      platform: values.platform as Parameters<typeof assembleSuiteBundle>[0]['platform'],
    });
    const bundledArtifacts = verified.components.filter((component) => component.delivery === 'artifact').length;
    console.log(`Assembled Agent Workspace Suite ${verified.suite_version} for ${verified.platform} (${verified.components.length} components; ${bundledArtifacts} bundled artifacts).`);
    return;
  }

  throw new Error('Use the draft, sign, or assemble command.');
}

async function readJson(path: string): Promise<unknown> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_LOCK_BYTES) throw new Error();
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('Suite lock file is unavailable, too large, or invalid JSON.');
  }
}

async function readTrustedKeys(specs: string[]): Promise<TrustedSuiteKeys> {
  const keys = new Map<string, ReturnType<typeof createPublicKey>>();
  for (const spec of specs) {
    const separator = spec.indexOf('=');
    if (separator < 1 || separator === spec.length - 1) throw new Error('Trusted keys must use ID=PUBLIC_KEY form.');
    const keyId = spec.slice(0, separator);
    const path = spec.slice(separator + 1);
    if (keys.has(keyId)) throw new Error('Trusted key IDs must be unique.');
    try {
      keys.set(keyId, createPublicKey(await readFile(path)));
    } catch {
      throw new Error('A trusted suite public key is unavailable or invalid.');
    }
  }
  return keys;
}

function safeCliMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /[\\/]|\b[A-Za-z]:/.test(message)
    ? 'Suite packaging failed; check the lock schema, key permissions, trusted key, artifact allowlist, and output directory.'
    : message || 'Suite packaging failed.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(safeCliMessage(error));
    process.exitCode = 1;
  });
}
