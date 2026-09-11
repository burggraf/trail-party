import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bookkeeping only: evidence presence does not prove that a test passed.
export function validateStatus(data, plan, exists = existsSync) {
  const errors = [];
  if (data?.version !== 1 || !Array.isArray(data.phases) || !data.phases.length) {
    return ['Expected version 1 and a nonempty phases array'];
  }
  if (typeof data.next_action !== 'string' || !data.next_action.trim()) errors.push('next_action is required');
  const expected = new Set([...plan.matchAll(/^(?:## (P\d{2}) —|### (P\d{2}\.T\d+) —|- \*\*(P\d{2}\.C\d+):\*\*)/gm)].map(m => m[1] ?? m[2] ?? m[3]));
  const seen = new Set();
  const previous = new Map();
  const states = ['pending', 'in_progress', 'blocked', 'complete'];
  const add = (item, allowed) => {
    if (!item || typeof item.id !== 'string') { errors.push('Missing item id'); return; }
    if (seen.has(item.id)) errors.push(`${item.id}: duplicate id`);
    seen.add(item.id);
    if (!expected.has(item.id)) errors.push(`${item.id}: not defined in plan`);
    if (!allowed.includes(item.status)) errors.push(`${item.id}: invalid status ${item.status}`);
  };
  for (const phase of data.phases) {
    add(phase, states);
    if (!phase || !Array.isArray(phase.tasks) || !Array.isArray(phase.criteria) || !Array.isArray(phase.depends_on) || !Array.isArray(phase.blockers)) {
      errors.push(`${phase?.id}: tasks, criteria, depends_on and blockers must be arrays`);
      continue;
    }
    for (const dependency of phase.depends_on) {
      if (!previous.has(dependency)) errors.push(`${phase.id}: dependency ${dependency} must be an earlier phase`);
      if (['in_progress', 'complete'].includes(phase.status) && previous.get(dependency) !== 'complete') {
        errors.push(`${phase.id}: prerequisite ${dependency} is not complete`);
      }
    }
    if (phase.status === 'blocked' && !phase.blockers.some(b => typeof b === 'string' && b.trim())) errors.push(`${phase.id}: blocker reason required`);
    if (phase.status === 'complete' && phase.blockers.length) errors.push(`${phase.id}: complete with unresolved blockers`);
    for (const task of phase.tasks) {
      add(task, states);
      if (!task?.id?.startsWith(`${phase.id}.T`)) errors.push(`${task?.id}: wrong parent phase`);
      if (phase.status === 'pending' && task?.status !== 'pending') errors.push(`${phase.id}: pending phase has started tasks`);
    }
    for (const criterion of phase.criteria) {
      add(criterion, ['pending', 'passed', 'failed', 'blocked']);
      if (!criterion?.id?.startsWith(`${phase.id}.C`)) errors.push(`${criterion?.id}: wrong parent phase`);
      if (!Array.isArray(criterion?.evidence)) { errors.push(`${criterion?.id}: evidence must be an array`); continue; }
      if (criterion.status === 'passed' && !criterion.evidence.length) errors.push(`${criterion.id}: passed without evidence`);
      for (const path of criterion.evidence) {
        if (typeof path !== 'string' || !/^docs\/evidence\/[A-Za-z0-9._-]+\.md$/.test(path) || !exists(path)) {
          errors.push(`${criterion.id}: missing evidence or invalid path ${path}`);
        }
      }
      if (phase.status === 'pending' && criterion.status !== 'pending') errors.push(`${phase.id}: pending phase has evaluated criteria`);
    }
    if (phase.status === 'complete' && (!phase.tasks.length || !phase.criteria.length || phase.tasks.some(t => t?.status !== 'complete') || phase.criteria.some(c => c?.status !== 'passed'))) {
      errors.push(`${phase.id}: incomplete tasks or acceptance criteria`);
    }
    previous.set(phase.id, phase.status);
  }
  for (const id of expected) if (!seen.has(id)) errors.push(`${id}: missing from status`);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? 'check';
    if (!['check', 'status'].includes(command)) throw new Error('Usage: node scripts/plan.mjs check|status');
    const data = JSON.parse(readFileSync('docs/STATUS.json', 'utf8'));
    const plan = readFileSync(data.plan, 'utf8');
    const errors = validateStatus(data, plan);
    if (errors.length) throw new Error(errors.join('\n'));
    if (command === 'check') {
      console.log(`Plan valid: ${data.phases.length} phases, ${data.phases.reduce((n, p) => n + p.tasks.length, 0)} tasks, ${data.phases.reduce((n, p) => n + p.criteria.length, 0)} criteria. Evidence truth requires review.`);
    } else {
      for (const p of data.phases) console.log(`${p.id} ${p.status.padEnd(11)} ${p.tasks.filter(t => t.status === 'complete').length}/${p.tasks.length} tasks | ${p.criteria.filter(c => c.status === 'passed').length}/${p.criteria.length} criteria | ${p.title}`);
      const ready = data.phases.filter(p => p.status !== 'complete' && p.status !== 'blocked' && p.depends_on.every(id => data.phases.find(d => d.id === id)?.status === 'complete'));
      console.log(`\nReady: ${ready.map(p => p.id).join(', ') || 'none (inspect blockers)'}`);
      console.log(`Next: ${data.next_action}`);
      for (const p of data.phases) for (const blocker of p.blockers) console.log(`Blocked ${p.id}: ${blocker}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
