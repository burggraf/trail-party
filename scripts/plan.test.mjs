import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStatus } from './plan.mjs';

const plan = '## P00 — Plan\n### P00.T1 — Write\n- **P00.C1:** Check\n## P01 — App\n### P01.T1 — Build\n- **P01.C1:** Test';
const fixture = () => ({
  version: 1,
  next_action: 'Start P01.T1',
  phases: [
    { id: 'P00', status: 'complete', depends_on: [], blockers: [],
      tasks: [{ id: 'P00.T1', status: 'complete' }],
      criteria: [{ id: 'P00.C1', status: 'passed', evidence: ['docs/evidence/P00.md'] }] },
    { id: 'P01', status: 'pending', depends_on: ['P00'], blockers: [],
      tasks: [{ id: 'P01.T1', status: 'pending' }],
      criteria: [{ id: 'P01.C1', status: 'pending', evidence: [] }] },
  ],
});
const check = (data, exists = () => true) => validateStatus(data, plan, exists);

test('accepts a valid resumable plan', () => assert.deepEqual(check(fixture()), []));
test('rejects completion with unfinished acceptance or tasks', () => {
  const data = fixture();
  data.phases[0].criteria[0].status = 'pending';
  data.phases[0].tasks[0].status = 'in_progress';
  assert.match(check(data).join('\n'), /P00.*incomplete/);
});
test('requires recorded existing evidence for passed criteria', () => {
  const data = fixture();
  data.phases[0].criteria[0].evidence = [];
  assert.match(check(data).join('\n'), /P00.C1.*evidence/);
  assert.match(check(fixture(), () => false).join('\n'), /missing evidence/);
});
test('rejects working ahead of prerequisites and cyclic/forward dependencies', () => {
  const data = fixture();
  data.phases[0].status = 'in_progress';
  data.phases[1].status = 'in_progress';
  assert.match(check(data).join('\n'), /P01.*prerequisite/);
  data.phases[0].depends_on = ['P01'];
  assert.match(check(data).join('\n'), /dependency.*earlier/);
});
test('requires blocker reasons and rejects skipped/unknown states', () => {
  const data = fixture();
  data.phases[1].status = 'blocked';
  assert.match(check(data).join('\n'), /P01.*blocker/);
  data.phases[1].criteria[0].status = 'skipped';
  assert.match(check(data).join('\n'), /invalid status/);
});
test('detects missing and duplicate IDs relative to the plan', () => {
  const data = fixture();
  data.phases[1].tasks = [];
  assert.match(check(data).join('\n'), /P01.T1.*missing/);
  data.phases.push(data.phases[0]);
  assert.match(check(data).join('\n'), /duplicate/);
});
test('rejects malformed documents and absent next action', () => {
  assert.ok(check(null).length > 0);
  const data = fixture();
  data.next_action = '';
  assert.match(check(data).join('\n'), /next_action/);
});
