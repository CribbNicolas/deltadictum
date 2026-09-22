import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { checkEvidenceFreshness } from '../../src/engine/evidence.js';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function makeStore() {
  const root = await mkdtemp(join(tmpdir(), 'dd-evidence-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  return { root, store };
}

function atomWithEvidence(sourceRef, hash) {
  return { id: 'atom-1', evidence_state: { artifacts: [{ source_type: 'file', source_ref: sourceRef, hash, provenance: 'filesystem', status: 'verified' }] } };
}

describe('checkEvidenceFreshness mtime/size fast path', () => {
  test('an unchanged file reports no drift and populates the derived cache', async t => {
    const { root, store } = await makeStore();
    t.after(() => store.close());
    await writeFile(join(root, 'evidence.txt'), 'original content');
    const atom = atomWithEvidence('evidence.txt', sha256('original content'));

    const reasons = await checkEvidenceFreshness(atom, store);
    assert.deepEqual(reasons, []);

    const cached = store.index.getEvidenceFreshness('atom-1', 'evidence.txt');
    assert.ok(cached, 'expected a cache row after the first check');
    assert.equal(cached.hash, sha256('original content'));
    const stats = await stat(join(root, 'evidence.txt'));
    assert.equal(cached.mtimeMs, stats.mtimeMs);
    assert.equal(cached.size, stats.size);
  });

  test('a file whose content and size actually changed is still detected', async t => {
    const { root, store } = await makeStore();
    t.after(() => store.close());
    await writeFile(join(root, 'evidence.txt'), 'original content');
    const atom = atomWithEvidence('evidence.txt', sha256('original content'));
    assert.deepEqual(await checkEvidenceFreshness(atom, store), []);

    await writeFile(join(root, 'evidence.txt'), 'a rewritten body of a different length');
    const reasons = await checkEvidenceFreshness(atom, store);
    assert.deepEqual(reasons, ['evidence_changed:evidence.txt']);
  });

  test('known gap: a matching mtime+size trusts the cached hash over the real file', async t => {
    // This is the accepted trade-off documented in src/engine/evidence.js's
    // hashWithCache: the fast path never re-reads the file when the cached
    // mtime and size still match, so a cache row that is wrong for its
    // mtime+size (which a real rewrite could only produce inside the same
    // filesystem mtime-resolution tick) is trusted instead of the real
    // content. This test proves the cache is genuinely consulted, not just
    // written, by observing that a poisoned-but-mtime-matching cache row
    // changes the outcome despite the real file being unchanged.
    const { root, store } = await makeStore();
    t.after(() => store.close());
    await writeFile(join(root, 'evidence.txt'), 'original content');
    const atom = atomWithEvidence('evidence.txt', sha256('original content'));
    assert.deepEqual(await checkEvidenceFreshness(atom, store), []);

    const stats = await stat(join(root, 'evidence.txt'));
    store.index.setEvidenceFreshness('atom-1', 'evidence.txt', { mtimeMs: stats.mtimeMs, size: stats.size, hash: 'poisoned-hash' });

    const reasons = await checkEvidenceFreshness(atom, store);
    assert.deepEqual(reasons, ['evidence_changed:evidence.txt']);
  });
});
