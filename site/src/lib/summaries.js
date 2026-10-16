// Every benchmark summary in docs/benchmarks/data, validated, newest first. A bad file fails the build.
import { validateSummary } from './bench.js';

const files = import.meta.glob('../../../docs/benchmarks/data/*.summary.json', { eager: true, import: 'default' });

export function loadSummaries() {
  return Object.entries(files).map(([path, summary]) => validateSummary(summary, path.replace(/^.*\/docs\//, 'docs/')))
    .sort((a, b) => b.date.localeCompare(a.date));
}
