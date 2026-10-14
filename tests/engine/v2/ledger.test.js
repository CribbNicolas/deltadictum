import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ledgerPath, openLedger, REPORT_LIMIT, TAIL_BYTES } from '../../../src/engine/ledger.cjs';

function dir(t) {
  const d = mkdtempSync(join(tmpdir(), 'dd-ledger-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('a memory is claimed once per epoch, and a new epoch re-arms it', t => {
  const ledger = openLedger(join(dir(t), 's.jsonl'));
  assert.deepEqual(ledger.claim(['a', 'b']), ['a', 'b']);
  assert.deepEqual(ledger.claim(['a', 'c']), ['c']);
  assert.deepEqual([...ledger.delivered()].sort(), ['a', 'b', 'c']);
  ledger.newEpoch('compact');
  assert.equal(ledger.epoch(), 1);
  assert.deepEqual(ledger.claim(['a']), ['a']);
});

test('the first claim in file order wins: a rival claim already appended is respected', t => {
  const path = join(dir(t), 's.jsonl');
  appendFileSync(path, `${JSON.stringify({ t: 'claim', m: 'a', n: 0, k: 'rival' })}\n`);
  assert.deepEqual(openLedger(path).claim(['a', 'b']), ['b']);
});

test('torn lines and unknown kinds are skipped', t => {
  const path = join(dir(t), 's.jsonl');
  writeFileSync(path, `${JSON.stringify({ t: 'claim', m: 'a', n: 0, k: 'x' })}\n{"t":"cla\n${JSON.stringify({ t: 'fp', path: 'src/a.js' })}\n`);
  assert.deepEqual(openLedger(path).claim(['a', 'b']), ['b']);
});

test('a ledger that cannot be written fails open: it delivers and never throws', t => {
  const path = join(dir(t), 'folder.jsonl');
  mkdirSync(path);
  assert.deepEqual(openLedger(path).claim(['a']), ['a']);
});

test('a large ledger is read from its tail', t => {
  const path = join(dir(t), 's.jsonl');
  const filler = `${JSON.stringify({ t: 'fp', path: 'x'.repeat(200) })}\n`.repeat(Math.ceil((TAIL_BYTES * 1.5) / 220));
  writeFileSync(path, `${JSON.stringify({ t: 'claim', m: 'old', n: 0, k: 'x' })}\n${filler}`);
  appendFileSync(path, `${JSON.stringify({ t: 'claim', m: 'recent', n: 0, k: 'x' })}\n`);
  assert.deepEqual(openLedger(path).claim(['recent', 'fresh']), ['fresh']);
});

test('ledger files are named by session and agent, safely', t => {
  const d = dir(t);
  assert.equal(ledgerPath(d, 'abc-123'), join(d, 'abc-123.jsonl'));
  assert.equal(ledgerPath(d, 'abc', 'agent/../x'), join(d, 'abc.agent----x.jsonl'));
  assert.equal(ledgerPath(d, ''), null);
});


test('violations are counted per memory and file in the current epoch', t => {
  const ledger = openLedger(join(dir(t), 's.jsonl'));
  assert.equal(ledger.reported('m1', 'src/a.js'), 0);
  ledger.report('m1', 'src/a.js');
  ledger.report('m1', 'src/a.js');
  ledger.report('m1', 'src/b.js');
  assert.equal(ledger.reported('m1', 'src/a.js'), 2);
  assert.equal(ledger.reported('m1', 'src/b.js'), 1);
  assert.deepEqual([...ledger.delivered()], []);
  ledger.newEpoch('compact');
  assert.equal(ledger.reported('m1', 'src/a.js'), 0);
  assert.equal(REPORT_LIMIT, 2);
});
