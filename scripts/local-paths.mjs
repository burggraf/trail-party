import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

// Walk, never realpath-and-adopt: even a symlink pointing back inside is refused.
export async function safeDirectory(root, name) {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Unsafe root symlink or type');
  const target = resolve(root, name);
  const suffix = relative(root, target);
  if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..') throw new Error('Path outside allowed root');
  let path = root;
  for (const part of suffix.split(sep)) {
    path = join(path, part);
    try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Unsafe root symlink');
    if (!info.isDirectory()) throw new Error('Expected local directory');
  }
  return target;
}

export async function inspectTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Unsafe depot or marker symlink');
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await inspectTree(join(path, name));
  } else if (!info.isFile() || info.nlink !== 1) {
    throw new Error('Unsafe depot file type or hard link');
  }
}
