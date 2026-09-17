import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('model evaluation transports identical tasks without exposing answers and preserves supplied usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-model-eval-'));
  const adapter = join(root, 'fixture-adapter.mjs');
  await writeFile(adapter, `let input=''; for await(const c of process.stdin) input+=c; const r=JSON.parse(input);
    if ('expected' in r.task || 'decision' in r.task || 'review' in r.task) process.exit(4);
    process.stdout.write(JSON.stringify({decision:'inspect_project',usage:{input_tokens:12,output_tokens:3}}));`);
  const out = join(root, 'report.json');
  const runner = fileURLToPath(new URL('../../../src/eval/model-runner.js', import.meta.url));
  await promisify(execFile)(process.execPath, [runner, '--adapter', adapter, '--model', 'fixture-only', '--limit', '2', '--out', out], { windowsHide: true });
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.rows.length, 6);
  assert.equal(report.summary.dd.input_tokens, 24);
  assert.equal(report.summary.none.total, report.summary.dd.total);
  assert.equal(report.model, 'fixture-only');
});
