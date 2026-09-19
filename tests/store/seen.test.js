import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSeen, markSeen, isSeen } from '../../src/store/seen.js';

async function withDataBase(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dd-seen-'));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try { await fn(dir); } finally {
    if (previous === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = previous;
  }
}

describe('per-user seen ledger', () => {
  test('a fresh data base with no seen.json yet reads as empty, not an error', () => withDataBase(async () => {
    assert.deepEqual(await readSeen(), {});
  }));

  test('marking an id seen persists it, and marking it again does not change the timestamp', () => withDataBase(async () => {
    await markSeen('atom-1');
    const first = await readSeen();
    assert.ok(first['atom-1']);
    await markSeen('atom-1');
    const second = await readSeen();
    assert.equal(second['atom-1'], first['atom-1']);
  }));

  test('isSeen reflects the ledger', () => withDataBase(async () => {
    await markSeen('atom-2');
    const seen = await readSeen();
    assert.equal(isSeen('atom-2', seen), true);
    assert.equal(isSeen('atom-3', seen), false);
  }));
});
