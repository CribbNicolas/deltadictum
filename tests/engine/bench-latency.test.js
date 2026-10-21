import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stalenessTiming, summarize, timeInterleaved, timeSpawn } from '../../src/eval/replay/latency.js';

test('interleaved timing alternates its commands, so machine drift hits them alike', () => {
  const order = [];
  const result = timeInterleaved({
    a: { prepare: i => { order.push(`a${i}`); return ['-e', '']; } },
    b: { prepare: i => { order.push(`b${i}`); return ['-e', '']; } },
  }, { runs: 2 });
  assert.deepEqual(order, ['a0', 'b0', 'a1', 'b1']);
  assert.ok(result.a.p50 > 0 && result.b.p50 > 0);
});

test('a timed process that fails stops the timing instead of being counted', () => {
  assert.throws(() => timeSpawn(['-e', 'process.exit(3)'], { runs: 1 }), /spawn_failed:3/);
});

test('each timed run can get its own arguments, such as a fresh ledger', () => {
  const seen = [];
  timeSpawn(null, { runs: 2, prepare: i => { seen.push(i); return ['-e', '']; } });
  assert.deepEqual(seen, [0, 1]);
});

test('timings summarize to the median and the 95th percentile', () => {
  assert.deepEqual(summarize([5, 1, 3, 2, 4]), { p50: 3, p95: 5 });
});

test('the staleness probes both run and report timings', async () => {
  const result = await stalenessTiming({ files: 20, runs: 5 });
  assert.ok(result.stat_all.p50 >= 0 && result.manifest.p50 >= 0);
});

test('the simulated hook answers with what fired and claims it once in the ledger', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-hook-sim-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const index = join(dir, 'index.json');
  const ledger = join(dir, 'ledger.jsonl');
  writeFileSync(index, JSON.stringify([{ id: 'm1', status: 'active', body: 'Close stores.', triggers: [{ on: ['read'], paths: ['src/a.js'] }] }]));
  const sim = fileURLToPath(new URL('../../src/eval/replay/hook-sim.mjs', import.meta.url));
  const event = JSON.stringify({ kind: 'read', paths: ['src/a.js'] });
  const first = JSON.parse(execFileSync(process.execPath, [sim, index, ledger], { input: event }).toString());
  const second = JSON.parse(execFileSync(process.execPath, [sim, index, ledger], { input: event }).toString());
  assert.equal(first.additionalContext, 'Close stores.');
  assert.equal(second.additionalContext, '');
  assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 1);
});
