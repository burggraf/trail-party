import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import manifest from './trailbase-releases.json' with { type: 'json' };
import { safeDirectory } from './local-paths.mjs';

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const versionTimeout = 5000;
const versionKillGrace = 100;
export function assertBackendVersion(binary = 'trail', { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('TrailBase version probe cancelled'));
  return new Promise((resolveVersion, rejectVersion) => {
    const child = spawn(binary, ['--version'], {
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', failure, timeout, hardKill;
    const abort = () => terminate(new Error('TrailBase version probe cancelled'));
    const finish = () => {
      clearTimeout(timeout); clearTimeout(hardKill); signal?.removeEventListener('abort', abort);
      if (failure) return rejectVersion(failure);
      const version = output.trim();
      if (version !== manifest.versionOutput) return rejectVersion(new Error('Required TrailBase version/source/SQLite mismatch; see scripts/trailbase-releases.json'));
      resolveVersion(version);
    };
    const terminate = reason => {
      if (failure) return;
      failure = reason;
      child.kill('SIGTERM');
      hardKill = setTimeout(() => child.kill('SIGKILL'), versionKillGrace);
    };
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
      if (output.length > 4096) terminate(new Error('TrailBase version probe output exceeded limit'));
    });
    child.stderr.resume();
    child.once('error', () => terminate(new Error('TrailBase required executable unavailable; run node scripts/setup-trailbase.mjs explicitly (no automatic install)')));
    child.once('close', (code, signal) => {
      if (!failure && (code !== 0 || signal)) failure = new Error('TrailBase required executable unavailable; run node scripts/setup-trailbase.mjs explicitly (no automatic install)');
      finish();
    });
    signal?.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => terminate(new Error('TrailBase version probe timed out')), versionTimeout);
  });
}
export function verifyArchive(bytes, artifact) {
  if (bytes.length !== artifact.size) throw new Error('Release archive size mismatch');
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Release archive digest mismatch');
}
export async function installRelease({ root = repository, target = `${process.platform}-${process.arch}` } = {}) {
  const artifact = manifest.artifacts[target];
  if (!artifact || target !== `${process.platform}-${process.arch}`) throw new Error('Unsupported target: setup only executes on its actual supported platform');
  const tools = await safeDirectory(root, '.local/tools');
  const destination = join(tools, `trailbase-v${manifest.version}-${target}`);
  // No reusable archive/binary cache, destination override or overwrite of an existing install.
  try { await lstat(destination); throw new Error('Release destination already exists; refusing cache substitution'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const lock = `${destination}.lock`;
  try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error('Release destination locked; refusing concurrent setup'); }
  let work;
  try {
    work = await mkdtemp(join(tools, '.download-'));
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Official release download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyArchive(bytes, artifact); // Must happen before any extraction or execution.
    const archive = join(work, 'release.zip');
    await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 });
    const { stdout: members } = await exec('unzip', ['-Z1', archive], { timeout: 10000, maxBuffer: 4096 });
    if (members.trim() !== 'trail\nCHANGELOG.md\nLICENSE') throw new Error('Unexpected release archive members');
    // Extract only bytes, never archive-controlled paths, permissions or symlinks.
    const { stdout: binary } = await exec('unzip', ['-p', archive, 'trail'], { encoding: 'buffer', timeout: 10000, maxBuffer: 128 * 1024 * 1024 });
    const executable = join(work, 'trail');
    await writeFile(executable, binary, { flag: 'wx', mode: 0o700 });
    await chmod(executable, 0o700);
    await assertBackendVersion(executable);
    await rm(archive);
    // Lock protects cooperating setup processes; refuse an externally substituted destination again.
    try { await lstat(destination); throw new Error('Release destination appeared during download'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await rename(work, destination); work = undefined;
    return { directory: destination, sha256: createHash('sha256').update(await readFile(join(destination, 'trail'))).digest('hex') };
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error(process.argv[2] === '--target' ? 'Unsupported target override' : 'Usage: node scripts/setup-trailbase.mjs (no destination overrides)');
    const installed = await installRelease();
    console.log(`Verified ${manifest.sourceCommit} / SQLite ${manifest.sqlite}; binary SHA256 ${installed.sha256}`);
    console.log(`Add to PATH explicitly: ${installed.directory}`);
  } catch (e) {
    // No subprocess stdout/stderr (including an incompatible executable's arbitrary output).
    console.error(e instanceof Error && !('cmd' in e) ? e.message : 'Release setup failed; check local prerequisites/network');
    process.exitCode = 1;
  }
}
