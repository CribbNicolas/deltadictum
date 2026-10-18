import ledgerkit from '../../src/eval/bench/projects/ledgerkit.js';
import { proveTasks } from './prove.js';

await ledgerkit.setup('main');
// BENCH_TASKS=a,b proves only those tasks.
proveTasks(ledgerkit, new URL('../../src/eval/bench/projects/ledgerkit/solutions/', import.meta.url), { only: process.env.BENCH_TASKS?.split(',') ?? null });
