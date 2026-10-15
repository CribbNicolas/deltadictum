import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitItems, renderDelivery, staleEvidence } from '../../../src/engine/deliver.cjs';

const item = (id, over = {}) => ({ id, title: `Title ${id}`, kind: 'trap', status: 'active', body: `Body ${id}.`, stale: [], ...over });

test('each memory arrives complete with its kind, a disputed mark and changed evidence', () => {
  const text = renderDelivery({ label: 'tests/mcp/tools.test.js', items: [
    item('a'), item('b', { kind: 'failed_approach', status: 'contested', stale: ['src/x.js'] }), item('c', { kind: 'decision' }),
  ] });
  assert.equal(text, [
    'DD - project knowledge (tests/mcp/tools.test.js):',
    '[TRAP] Title a - Body a.',
    '[ABANDONED] [DISPUTED] Title b - Body b. (evidence changed since this was written: src/x.js)',
    '[DECISION] Title c - Body c.',
  ].join('\n'));
  assert.equal(renderDelivery({ label: 'x', items: [] }), '');
});

test('past the limit, whole memories are named instead of cut', () => {
  const items = Array.from({ length: 5 }, (_, i) => item(`m${i}`, { body: 'x'.repeat(300) }));
  const text = renderDelivery({ label: 'p', items, limit: 720 });
  assert.ok(text.length <= 720, text.length);
  assert.match(text, /\[TRAP\] Title m0 - x{300}\n\[TRAP\] Title m1 - x{300}\n\.\.\. and 3 more: Title m2; Title m3; Title m4$/);
});

// A migrated memory may be far longer than 1,500 characters: one that cannot fit
// must not keep every memory after it from arriving.
test('a memory too long to fit is named, and the ones after it still arrive in full', () => {
  const items = [item('m0', { body: 'x'.repeat(300) }), item('huge', { body: 'y'.repeat(5000) }), item('m2', { body: 'z'.repeat(300) })];
  const fits = fitItems({ label: 'p', items, limit: 1000 });
  assert.deepEqual(fits.map(i => i.id), ['m0', 'm2']);
  const text = renderDelivery({ label: 'p', items: fits, named: [items[1]], limit: 1000 });
  assert.ok(text.length <= 1000, text.length);
  assert.match(text, /\[TRAP\] Title m0 - x{300}\n\[TRAP\] Title m2 - z{300}\n\.\.\. and 1 more: Title huge$/);
});

test('evidence is stale when its file changed or is gone', t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-deliver-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'a.js'), 'one');
  const sha = text => createHash('sha256').update(text).digest('hex');
  assert.deepEqual(staleEvidence(root, [{ path: 'a.js', sha256: sha('one') }]), []);
  assert.deepEqual(staleEvidence(root, [{ path: 'a.js', sha256: sha('two') }, { path: 'gone.js', sha256: sha('x') }]), ['a.js', 'gone.js']);
});
