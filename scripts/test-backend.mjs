import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (args.length !== 1 || !['capabilities', 'schema', 'auth'].includes(args[0])) {
  console.error('Usage: pnpm test:backend -- capabilities|schema|auth (owned local depot only)');
  process.exit(1);
}
const env = { ...process.env };
const commands = args[0] === 'capabilities'
  ? [
      ['pnpm', ['build:backend:probe']],
      [process.execPath, ['--test', 'tests/backend/ownership.test.ts', 'tests/backend/capabilities.test.ts']],
    ]
  : args[0] === 'schema'
    ? [
        ['pnpm', ['build:backend:probe']],
        [process.execPath, ['--test', 'tests/backend/schema.test.ts']],
      ]
    : [
        ['pnpm', ['build:backend:probe']],
        ['pnpm', ['build:backend:app']],
        [process.execPath, ['--test', 'tests/backend/auth.test.ts', 'tests/backend/return-to-origin.test.ts']],
      ];
for (const [command, flags] of commands) {
  const result = spawnSync(command, flags, { stdio: 'inherit', env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
