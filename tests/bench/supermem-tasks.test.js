import supermem from '../../src/eval/bench/projects/supermem.js';
import { proveTasks } from './prove.js';

// BENCH_TASKS=a,b proves only those tasks.
proveTasks(supermem, new URL('../../src/eval/bench/projects/supermem/solutions/', import.meta.url), { only: process.env.BENCH_TASKS?.split(',') ?? null });
