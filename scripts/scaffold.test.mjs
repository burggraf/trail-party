import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// P01.T1 / P01.C1 / F01: structural checks complement real browser smoke.
test('browser checks use the documented Chrome channel with no acceptance retries', () => {
  const config = readFileSync('playwright.shell.config.ts', 'utf8');
  assert.match(config, /channel:\s*['"]chrome['"]/);
  assert.match(config, /retries:\s*0/);
  assert.match(config, /reuseExistingServer:\s*false/);
  assert.match(readFileSync('docs/TESTING.md', 'utf8'), /channel: 'chrome'/);
});
test('shared static shell has runnable quality gates and strict TypeScript', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of ['check', 'lint', 'test:unit', 'build', 'test:shell']) {
    assert.ok(pkg.scripts[name], `missing ${name} command`);
  }
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must pin a stable exact version`);
  }
  assert.ok(existsSync('pnpm-lock.yaml'), 'dependency lockfile required');
  assert.ok(existsSync('src-tauri/Cargo.lock'), 'native dependency lockfile required');
  assert.equal(JSON.parse(readFileSync('tsconfig.json', 'utf8')).compilerOptions.strict, true);
});

test('browser and native use one static app, native starts on display', () => {
  assert.ok(existsSync('svelte.config.js'), 'static app configuration missing');
  assert.match(readFileSync('svelte.config.js', 'utf8'), /fallback:\s*['"]index.html['"]/);
  assert.match(readFileSync('src/routes/+layout.ts', 'utf8'), /ssr\s*=\s*false/);
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(config.build.frontendDist, '../build');
  assert.equal(config.app.windows[0].url, '/display');
  assert.equal(config.version, '../package.json');
  assert.ok(config.app.security.csp, 'native CSP required');
  const capabilities = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  assert.deepEqual(capabilities.permissions, [], 'no native commands needed for this shell');
});
