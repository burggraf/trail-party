import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (args.length !== 1 || args[0] !== 'capabilities') {
  console.error('Usage: pnpm test:backend -- capabilities (owned local depot only)');
  process.exit(1);
}
for (const [command, flags] of [
  ['pnpm', ['build:backend:probe']],
  [process.execPath, ['--test', 'tests/backend/ownership.test.ts', 'tests/backend/capabilities.test.ts']],
]) {
  const result = spawnSync(command, flags, { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
