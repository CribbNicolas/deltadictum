// Order and intervals for the full benchmark. Runs are shuffled so that a slow
// afternoon or a usage limit does not fall on one condition; comparisons are
// paired by task, since tasks differ far more than conditions do.

// mulberry32: small, fast, and the same sequence on every machine for a seed.
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Repetition-major, so a stopped trial still has every task in every condition.
export function schedule(tasks, conditions, repeat, done, seed) {
  const rand = random(seed);
  const jobs = [];
  for (let i = 0; i < repeat; i += 1) {
    const round = tasks.flatMap(task => conditions.map(condition => [task, condition, i]));
    jobs.push(...shuffle(round, rand).filter(([task, condition]) => !done.has(`${task.id}-${condition}-${i}`)));
  }
  return jobs;
}

const meanOf = values => values.reduce((a, b) => a + b, 0) / values.length;

export function pairedDiffs(rows, a, b, value) {
  const byTask = new Map();
  for (const row of rows) {
    const v = value(row);
    if (typeof v !== 'number' || ![a, b].includes(row.condition)) continue;
    const entry = byTask.get(row.task) ?? { [a]: [], [b]: [] };
    entry[row.condition].push(v);
    byTask.set(row.task, entry);
  }
  return [...byTask.values()].filter(e => e[a].length && e[b].length).map(e => meanOf(e[a]) - meanOf(e[b]));
}

// Percentile bootstrap over the values (one per task).
export function bootstrapMean(values, { iterations = 2000, seed = 1 } = {}) {
  if (!values.length) return { n: 0, mean: null, ci95: null };
  const rand = random(seed);
  const means = [];
  for (let k = 0; k < iterations; k += 1) {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) sum += values[Math.floor(rand() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((x, y) => x - y);
  return { n: values.length, mean: meanOf(values), ci95: [means[Math.floor(iterations * 0.025)], means[Math.ceil(iterations * 0.975) - 1]] };
}
