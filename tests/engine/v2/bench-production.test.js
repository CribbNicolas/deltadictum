import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileIndex, writeCompiled } from '../../../src/engine/compile.js';
import { localPaths } from '../../../src/engine/locate.cjs';
import { productionEngine } from '../../../src/eval/v2bench/engine.js';
import { loadFixture } from '../../../src/eval/v2bench/fixture.js';
import { replay } from '../../../src/eval/v2bench/replay.js';
import { synthesizeMemories } from '../../../src/eval/v2bench/synth.js';

const plain = results => results.map(r => [r.run_id, [...r.delivered].map(([id, hit]) => `${id}@${hit.at}:${hit.via.join('+')}`).sort()]);

test('the production engine delivers exactly what the reference does on the bench fixture', async () => {
  const fixture = await loadFixture();
  const memories = synthesizeMemories(fixture);
  assert.deepEqual(plain(replay(fixture, memories, productionEngine)), plain(replay(fixture, memories)));
});

test('the production hook answers once per epoch with the complete memory', t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-hook-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = localPaths(root);
  mkdirSync(p.memories, { recursive: true });
  writeFileSync(p.manifest, JSON.stringify({ version: 1, count: 1, hash: 'h' }));
  const memory = { id: 'm1', topic: 't/m1', kind: 'trap', status: 'active', title: 'Close stores', body: 'Close them in t.after.',
    evidence: [], triggers: [{ on: ['read'], paths: ['src/a.js'] }] };
  writeCompiled(p, compileIndex({ memories: [memory], manifest: { count: 1, hash: 'h' } }));
  const hook = fileURLToPath(new URL('../../../src/eval/v2bench/hook-real.cjs', import.meta.url));
  const input = JSON.stringify({ kind: 'read', paths: ['src/a.js'] });
  const run = () => JSON.parse(execFileSync(process.execPath, [hook, root, 'session-1'], { input }).toString() || '{}');
  assert.equal(run().additionalContext, 'DD - project knowledge (src/a.js):\n[TRAP] Close stores - Close them in t.after.\n'
    + 'DD - advisory: knowledge, not an order. Apply it unless the user explicitly asked for what it rules out; then do what the user asked and say which memory it departs from.');
  assert.equal(run().additionalContext, undefined);
});
