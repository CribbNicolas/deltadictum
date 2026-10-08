import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, killTree } from '../../../src/eval/agent/proc.js';

// A child that leaves a grandchild holding its stdout: 'close' never fires on its own.
// It lives 8 s; waiting for 'close' alone would take that long.
const ORPHAN = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit' }).unref(); console.log('started');`;

test('a run settles when its child exits even if a grandchild keeps the pipes open', async () => {
  const started = Date.now();
  const out = await run(process.execPath, ['-e', ORPHAN], { timeout: 30000, grace: 500 });
  assert.equal(out.code, 0);
  assert.equal(out.timedOut, false);
  assert.match(out.out, /started/);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test('a timeout stops the whole tree behind a shell and returns what was written', async () => {
  const marker = `dd-proc-test-${process.pid}-${Date.now()}`;
  const script = `console.log('working'); require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '${marker}'], { stdio: 'inherit' }); setTimeout(() => {}, 60000);`;
  const started = Date.now();
  const out = await run(`"${process.execPath}"`, ['-e', `"${script.replaceAll('"', '\\"')}"`], { shell: true, timeout: 1500, grace: 500 });
  assert.equal(out.timedOut, true);
  assert.match(out.out, /working/);
  assert.ok(Date.now() - started < 15000, `took ${Date.now() - started} ms`);
});

test('killing a finished process is harmless', () => {
  assert.doesNotThrow(() => killTree(999999));
});
