import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const round = value => Math.round(value * 10) / 10;
export function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { p50: round(at(0.5)), p95: round(at(0.95)) };
}

// Wall time of a fresh Node process with these arguments, as a hook pays it.
// prepare(i) gives run i its own arguments (a fresh ledger, so every run does the
// same work); a run that fails stops the timing rather than being counted.
export function timeSpawn(args, { runs = 30, input = '', prepare } = {}) {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const argv = prepare ? prepare(i) : args;
    const start = performance.now();
    const result = spawnSync(process.execPath, argv, { input, windowsHide: true });
    times.push(performance.now() - start);
    if (result.status !== 0) throw new Error(`spawn_failed:${result.status}:${String(result.stderr ?? '').slice(0, 200)}`);
  }
  return summarize(times);
}

// Several commands timed in alternation, run by run, so that machine drift (a
// baseline that moves 3 ms between batches) hits all of them alike.
// specs: { name: { prepare(i) -> argv, input } }.
export function timeInterleaved(specs, { runs = 40 } = {}) {
  const times = Object.fromEntries(Object.keys(specs).map(name => [name, []]));
  for (let i = 0; i < runs; i += 1) {
    for (const [name, spec] of Object.entries(specs)) {
      const argv = spec.prepare(i);
      const start = performance.now();
      const result = spawnSync(process.execPath, argv, { input: spec.input ?? '', windowsHide: true });
      times[name].push(performance.now() - start);
      if (result.status !== 0) throw new Error(`spawn_failed:${name}:${result.status}:${String(result.stderr ?? '').slice(0, 200)}`);
    }
  }
  return Object.fromEntries(Object.entries(times).map(([name, list]) => [name, summarize(list)]));
}

// The two ways a hook can tell its index is stale (spec section 3): stat every
// memory file, or read one manifest the store rewrites on each write.
export async function stalenessTiming({ files = 200, runs = 50 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dd-staleness-'));
  try {
    for (let i = 0; i < files; i += 1) writeFileSync(join(dir, `m${i}.json`), JSON.stringify({ id: `m${i}`, body: 'x'.repeat(800) }));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ count: files, hash: 'h' }));
    const time = probe => {
      const times = [];
      for (let i = 0; i < runs; i += 1) { const start = performance.now(); probe(); times.push(performance.now() - start); }
      return summarize(times);
    };
    const statAll = () => {
      let newest = 0, size = 0, count = 0;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json') || name === 'manifest.json') continue;
        const info = statSync(join(dir, name));
        newest = Math.max(newest, info.mtimeMs); size += info.size; count += 1;
      }
      return `${count}:${newest}:${size}`;
    };
    const manifest = () => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).hash;
    return { files, stat_all: time(statAll), manifest: time(manifest) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
