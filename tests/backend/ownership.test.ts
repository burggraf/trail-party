import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { removeOwnedDepot } from './stack.ts';

test('cleanup refuses unmarked/wrong-owner directories and removes only its marked depot', async () => {
  const root = resolve('.local/test-runs');
  await mkdir(root, { recursive: true });
  const depot = await mkdtemp(join(root, 'ownership-'));
  const marker = randomUUID();
  try {
    await assert.rejects(removeOwnedDepot(resolve('.'), marker), /outside test root/);
    await assert.rejects(removeOwnedDepot(root, marker), /outside test root/);
    await writeFile(join(depot, 'keep.txt'), 'keep');
    await assert.rejects(removeOwnedDepot(depot, marker));
    await writeFile(join(depot, '.owner'), marker);
    await assert.rejects(removeOwnedDepot(depot, 'not-the-owner'));
    assert.equal(await readFile(join(depot, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    await writeFile(join(depot, '.owner'), marker);
    await removeOwnedDepot(depot, marker);
  }
  await assert.rejects(readFile(join(depot, 'keep.txt')));
});
