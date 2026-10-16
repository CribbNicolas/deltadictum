import { pathToFileURL } from 'node:url';
import patriark, { available } from '../../src/eval/bench/projects/patriark.js';
import { proveTasks } from './prove.js';

// BENCH_TASKS=a,b proves only those tasks; nothing runs on a machine without the Patriark repository. The
// solutions are Patriark's own source, generated from its repository into output/eval.
if (available) {
  const { ensureGenerated, SOLUTIONS } = await import('../../src/eval/bench/projects/patriark/generate.mjs');
  ensureGenerated();
  proveTasks(patriark, pathToFileURL(`${SOLUTIONS}/`), { only: process.env.BENCH_TASKS?.split(',') ?? null });
}
