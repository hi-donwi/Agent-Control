import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SUITE_COMPONENT_IDS, validateSuiteLockDraft, type SuiteArtifactComponentId, type SuiteLockComponent, type SuiteLockDraft, type SuitePlatform } from './suite-lock.js';

const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export interface SuiteLockMetadata {
  schema_version: 1;
  suite_version: string;
  platform: SuitePlatform;
  components: SuiteLockMetadataComponent[];
}

export type SuiteLockMetadataComponent =
  | { id: 'agent-brain'; delivery: 'service'; version: string; service_contract: 'agent-brain-profile-v1' }
  | { id: SuiteArtifactComponentId; delivery: 'artifact'; version: string; artifact_name: string };

/** Create a digest lock draft from the exact staged component release files. */
export async function createSuiteLockDraft(metadataInput: unknown, artifactsDirectory: string): Promise<SuiteLockDraft> {
  const metadata = validateMetadata(metadataInput);
  const artifactsRoot = resolve(artifactsDirectory);
  let rootInfo;
  try {
    rootInfo = await lstat(artifactsRoot);
  } catch {
    throw new Error('Artifact staging directory is unavailable.');
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Artifact staging must be a regular directory.');
  const entries = await readdir(artifactsRoot, { withFileTypes: true }).catch(() => {
    throw new Error('Artifact staging directory could not be read.');
  });
  const artifactComponents = metadata.components.filter((component) => component.delivery === 'artifact');
  const names = new Set(artifactComponents.map((component) => component.artifact_name));
  if (entries.length !== names.size || entries.some((entry) => !entry.isFile() || !names.has(entry.name))) {
    throw new Error(`Artifact staging must contain exactly the ${names.size} files declared by metadata.`);
  }

  const hashes = new Map<string, string>();
  for (const component of artifactComponents) {
    const sourcePath = join(artifactsRoot, component.artifact_name);
    let before;
    try {
      before = await lstat(sourcePath);
    } catch {
      throw new Error('A declared component artifact is unavailable.');
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_ARTIFACT_BYTES) {
      throw new Error('A component artifact must be a size-bounded regular file.');
    }
    let handle;
    try {
      if (!constants.O_NOFOLLOW) throw new Error();
      handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new Error('A declared component artifact could not be opened safely.');
    }
    try {
      const after = await handle.stat();
      if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
        throw new Error('A component artifact changed during hashing.');
      }
      const hash = createHash('sha256');
      let bytes = 0;
      const hashAndLimit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_ARTIFACT_BYTES) {
            callback(new Error('Artifact size limit exceeded.'));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(handle.createReadStream({ autoClose: false }), hashAndLimit, new Writable({
        write(_chunk, _encoding, callback) { callback(); },
      })).catch(() => {
        throw new Error('A component artifact could not be hashed safely.');
      });
      const afterRead = await handle.stat();
      if (afterRead.size !== before.size || bytes !== before.size) throw new Error('A component artifact changed during hashing.');
      hashes.set(component.id, `sha256:${hash.digest('hex')}`);
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  const components: SuiteLockComponent[] = metadata.components.map((component) => component.delivery === 'service'
    ? component
    : { ...component, sha256: hashes.get(component.id)! });
  return validateSuiteLockDraft({ ...metadata, components });
}

function validateMetadata(input: unknown): SuiteLockMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new Error('Suite draft metadata must be a JSON object.');
  }
  const metadata = input as Record<string, unknown>;
  const expectedKeys = ['components', 'platform', 'schema_version', 'suite_version'];
  const actualKeys = Object.keys(metadata).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Suite draft metadata contains unsupported or missing fields.');
  }
  if (!Array.isArray(metadata.components) || metadata.components.length !== SUITE_COMPONENT_IDS.length) {
    throw new Error('Suite draft metadata must declare exactly the five components.');
  }
  const components = metadata.components.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      throw new Error('Suite component metadata must be a JSON object.');
    }
    const component = value as Record<string, unknown>;
    const expectedID = SUITE_COMPONENT_IDS[index];
    if (component.id !== expectedID) throw new Error('Suite draft components must appear once in canonical order.');
    const expected = expectedID === 'agent-brain'
      ? ['delivery', 'id', 'service_contract', 'version']
      : ['artifact_name', 'delivery', 'id', 'version'];
    const keys = Object.keys(component).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error('Suite component metadata contains unsupported or missing fields.');
    }
    if (typeof component.version !== 'string') {
      throw new Error('Suite component metadata fields have invalid types.');
    }
    if (expectedID === 'agent-brain') {
      if (component.delivery !== 'service' || component.service_contract !== 'agent-brain-profile-v1') {
        throw new Error('Agent-Brain must be declared as the external profile-enabled service.');
      }
      return { id: 'agent-brain' as const, delivery: 'service' as const, version: component.version, service_contract: 'agent-brain-profile-v1' as const };
    }
    if (component.delivery !== 'artifact' || typeof component.artifact_name !== 'string') {
      throw new Error('Bundled suite components must declare a safe artifact.');
    }
    return { id: expectedID as SuiteArtifactComponentId, delivery: 'artifact' as const, version: component.version, artifact_name: component.artifact_name };
  });
  const placeholderDraft = {
    schema_version: metadata.schema_version,
    suite_version: metadata.suite_version,
    platform: metadata.platform,
    components: components.map((component) => component.delivery === 'service'
      ? component
      : { ...component, sha256: `sha256:${'0'.repeat(64)}` }),
  };
  const validated = validateSuiteLockDraft(placeholderDraft);
  return {
    schema_version: validated.schema_version,
    suite_version: validated.suite_version,
    platform: validated.platform,
    components: validated.components.map((component) => component.delivery === 'service'
      ? { id: component.id, version: component.version, delivery: component.delivery, service_contract: component.service_contract }
      : { id: component.id, version: component.version, delivery: component.delivery, artifact_name: component.artifact_name }),
  };
}
