import tollgate from '../../src/eval/bench/projects/tollgate.js';
import { proveTasks } from './prove.js';

await tollgate.setup('main');
// BENCH_TASKS=a,b proves only those tasks.
proveTasks(tollgate, new URL('../../src/eval/bench/projects/tollgate/solutions/', import.meta.url), { only: process.env.BENCH_TASKS?.split(',') ?? null });
