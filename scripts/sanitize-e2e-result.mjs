import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';

const [, , inputPath, outputPath, mode = 'induced'] = process.argv;
if (!inputPath || !outputPath || !['induced', 'green'].includes(mode)) {
  throw new Error('usage: node scripts/sanitize-e2e-result.mjs <input.json> <output.json> [induced|green]');
}

const report = JSON.parse(await readFile(inputPath, 'utf8'));
const tests = [];
const traces = [];
const skipped = [];

async function visit(suite, inheritedFile = '') {
  const file = suite.file ?? inheritedFile;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const expectedSkip = test.expectedStatus === 'skipped';
      if (test.status === 'skipped' && !expectedSkip) skipped.push(`${spec.title} (${test.projectName})`);
      for (const result of test.results ?? []) {
        if (result.status === 'skipped' && !expectedSkip) skipped.push(`${spec.title} (${test.projectName})`);
        const attachments = (result.attachments ?? []).map(attachment => attachment.name);
        const browserVersion = (result.annotations ?? test.annotations ?? [])
          .find(annotation => annotation.type === 'browser-version')?.description;
        tests.push({
          file: basename(file),
          title: spec.title,
          project: test.projectName,
          status: result.status,
          expected_status: test.expectedStatus,
          duration_ms: result.duration,
          retry: result.retry,
          browser_version: browserVersion ?? 'unknown',
          attachments,
        });
        for (const attachment of result.attachments ?? []) {
          if (attachment.name !== 'trace' || !attachment.path) continue;
          const bytes = await readFile(attachment.path);
          const metadata = await stat(attachment.path);
          traces.push({
            name: 'induced-failure-trace.zip',
            bytes: metadata.size,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            retained_locally: true,
          });
        }
      }
    }
  }
  for (const child of suite.suites ?? []) await visit(child, file);
}

for (const suite of report.suites ?? []) await visit(suite);
if (skipped.length > 0) throw new Error(`Unexpected skipped Playwright tests: ${skipped.join(', ')}`);
if (tests.length === 0) throw new Error('Playwright result did not contain a test');
if (mode === 'induced' && traces.length === 0) throw new Error('induced result did not contain a trace');

await writeFile(outputPath, JSON.stringify({
  schema: 1,
  expected_failure: mode === 'induced',
  tests,
  traces,
}, null, 2), { mode: 0o600 });
