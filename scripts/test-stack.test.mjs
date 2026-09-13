import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { removeOwnedDepot } from './test-stack.mjs';

test('test-stack refuses foreign depot cleanup and permits only its marker owner', async () => {
  const root = resolve('.local/test-runs');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const depot = await mkdtemp(join(root, 'safety-'));
  const owner = 'owner-a';
  await writeFile(join(depot, '.owner'), owner, { mode: 0o600 });
  await assert.rejects(
    removeOwnedDepot(depot, 'owner-b'),
    /unowned test depot/u,
  );
  assert.equal(await readFile(join(depot, '.owner'), 'utf8'), owner);
  await removeOwnedDepot(depot, owner);
  await assert.rejects(() => readFile(depot), /ENOENT/u);
  await rm(depot, { recursive: true, force: true });
});
