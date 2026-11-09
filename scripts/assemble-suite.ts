import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifySuiteLock, type SuiteArtifactComponent, type SuiteLock, type SuitePlatform, type TrustedSuiteKeys } from './suite-lock.js';

const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export interface AssembleSuiteOptions {
  lock: unknown;
  artifactsDirectory: string;
  outputDirectory: string;
  trustedKeys: TrustedSuiteKeys;
  platform: SuitePlatform;
}

/** Verify a signed five-component lock and stage only its exact artifact allowlist. */
export async function assembleSuiteBundle(options: AssembleSuiteOptions): Promise<SuiteLock> {
  if (!constants.O_NOFOLLOW) throw new Error('Suite assembly requires symlink-safe file access on the build host.');
  const lock = verifySuiteLock(options.lock, options.trustedKeys, options.platform);
  const artifactsDirectory = resolve(options.artifactsDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  if (pathsOverlap(artifactsDirectory, outputDirectory)) {
    throw new Error('Artifact staging and suite output directories must be separate.');
  }

  let directoryInfo;
  try {
    directoryInfo = await lstat(artifactsDirectory);
  } catch {
    throw new Error('Artifact staging directory is unavailable.');
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error('Artifact staging must be a regular directory.');
  }

  let entries;
  try {
    entries = await readdir(artifactsDirectory, { withFileTypes: true });
  } catch {
    throw new Error('Artifact staging directory could not be read.');
  }
  const artifacts = lock.components.filter((component): component is SuiteArtifactComponent => component.delivery === 'artifact');
  const expectedNames = new Set(artifacts.map((component) => component.artifact_name));
  if (entries.length !== expectedNames.size || entries.some((entry) => !entry.isFile() || !expectedNames.has(entry.name))) {
    throw new Error(`Artifact staging must contain exactly the ${expectedNames.size} files declared by the signed suite lock.`);
  }

  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch {
    throw new Error('Suite output must be a new directory whose parent already exists.');
  }

  try {
    for (const component of artifacts) {
      const sourcePath = join(artifactsDirectory, component.artifact_name);
      let sourceInfo;
      try {
        sourceInfo = await lstat(sourcePath);
      } catch {
        throw new Error('A declared component artifact is unavailable.');
      }
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > MAX_ARTIFACT_BYTES) {
        throw new Error('A declared component artifact is not an acceptable regular file.');
      }
      const componentDirectory = join(outputDirectory, 'components', component.id);
      await mkdir(componentDirectory, { recursive: true, mode: 0o755 });
      const outputPath = join(componentDirectory, component.artifact_name);
      const digest = createHash('sha256');
      let bytes = 0;
      const hashAndLimit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_ARTIFACT_BYTES) {
            callback(new Error('Artifact size limit exceeded.'));
            return;
          }
          digest.update(chunk);
          callback(null, chunk);
        },
      });
      let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const openedInfo = await sourceHandle.stat();
        if (!openedInfo.isFile() || openedInfo.dev !== sourceInfo.dev || openedInfo.ino !== sourceInfo.ino) {
          throw new Error('Artifact changed during staging.');
        }
        await pipeline(
          sourceHandle.createReadStream({ autoClose: false }),
          hashAndLimit,
          createWriteStream(outputPath, { flags: 'wx', mode: 0o644 }),
        );
      } catch {
        throw new Error('A declared component artifact could not be staged.');
      } finally {
        await sourceHandle?.close().catch(() => undefined);
      }
      if (`sha256:${digest.digest('hex')}` !== component.sha256) {
        throw new Error('A component artifact does not match its signed SHA-256 digest.');
      }
    }

    try {
      await writeFile(join(outputDirectory, 'suite.lock.json'), `${JSON.stringify(lock, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o644,
      });
      await chmod(outputDirectory, 0o755);
    } catch {
      throw new Error('Suite metadata could not be written.');
    }
    return lock;
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof Error && /signed SHA-256|size limit|declared component|component artifact/.test(error.message)) {
      throw error;
    }
    throw new Error('Suite assembly failed; no output bundle was retained.');
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  const within = (path: string) => path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
  return within(fromLeft) || within(fromRight);
}
