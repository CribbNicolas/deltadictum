import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fileHash, hashMatches } = require('../../src/engine/file-hash.cjs');
const { staleEvidence } = require('../../src/engine/deliver.cjs');

const raw = content => createHash('sha256').update(content).digest('hex');

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-hash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A checkout with core.autocrlf holds CRLF on Windows and LF elsewhere: the same file must hash the same.
test('a text file hashes the same with CRLF and LF line endings', t => {
  const root = project(t);
  writeFileSync(join(root, 'lf.js'), 'a\nb\n');
  writeFileSync(join(root, 'crlf.js'), 'a\r\nb\r\n');
  assert.equal(fileHash(join(root, 'crlf.js')), fileHash(join(root, 'lf.js')));
  assert.equal(fileHash(join(root, 'lf.js')), raw('a\nb\n'));
});

test('a binary file, or a lone carriage return, is hashed as it is', t => {
  const root = project(t);
  const binary = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
  writeFileSync(join(root, 'b.bin'), binary);
  writeFileSync(join(root, 'cr.txt'), 'a\rb');
  assert.equal(fileHash(join(root, 'b.bin')), raw(binary));
  assert.equal(fileHash(join(root, 'cr.txt')), raw('a\rb'));
});

test('evidence stays fresh across line endings, and a hash recorded raw before still matches', t => {
  const root = project(t);
  writeFileSync(join(root, 'f.js'), 'x\r\ny\r\n');
  assert.equal(hashMatches(join(root, 'f.js'), raw('x\ny\n')), true);
  assert.equal(hashMatches(join(root, 'f.js'), raw('x\r\ny\r\n')), true);
  assert.deepEqual(staleEvidence(root, [{ path: 'f.js', sha256: raw('x\ny\n') }]), []);
  writeFileSync(join(root, 'f.js'), 'x\r\nz\r\n');
  assert.deepEqual(staleEvidence(root, [{ path: 'f.js', sha256: raw('x\ny\n') }, { path: 'gone.js', sha256: raw('') }]), ['f.js', 'gone.js']);
});
