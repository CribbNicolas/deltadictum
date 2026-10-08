import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitTransaction } from '../../src/store/transactions.js';

test('the journal writes and removes memory files and still refuses paths outside .dd', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-journal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await commitTransaction(dir, [{ path: 'memories/m1.json', value: { a: 1 } }, { path: 'memories/manifest.json', value: { count: 1 } }]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'memories', 'm1.json'), 'utf8')), { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'memories', 'manifest.json'), 'utf8')), { count: 1 });
  await assert.rejects(commitTransaction(dir, [{ path: 'memories/../x.json', value: {} }]), /invalid_journal_path/);
  await commitTransaction(dir, [{ path: 'memories/m1.json', value: null }]);
  assert.equal(existsSync(join(dir, 'memories', 'm1.json')), false);
});
