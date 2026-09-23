import { describe, test } from 'node:test';
import assert from 'node:assert';
import { resolveKey } from '../../../src/engine/v5/resolver.js';

const entry = { id: 'reg-1', canonical_key: 'memory/compaction', status: 'canonical', notes: null };
const aliasRows = [{ alias: 'memoria/compactacion', kind: 'translation', lang: 'es' }];

function buildRepository({ byKey = null, aliasRow = null } = {}) {
  return {
    getRegistryEntryByKey: async (projectId, key) => (byKey && key === byKey.canonical_key ? byKey : null),
    getAliasByName: async (projectId, alias) => (aliasRow && alias === aliasRow.alias ? aliasRow : null),
    getRegistryEntryById: async id => (id === entry.id ? entry : null),
    getAliasesForRegistry: async () => aliasRows,
  };
}

describe('V5 resolver', () => {
  test('resolves canonical key directly', async () => {
    const repository = buildRepository({ byKey: entry });
    const result = await resolveKey('demo', 'Memory/Compaction', { repository });
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.registry_id, 'reg-1');
    assert.strictEqual(result.canonical_key, 'memory/compaction');
    assert.strictEqual(result.via, 'canonical');
    assert.deepStrictEqual(result.aliases, aliasRows);
  });

  test('resolves alias (accent-insensitive) to canonical entry', async () => {
    const repository = buildRepository({ aliasRow: { alias: 'memoria/compactacion', registry_id: 'reg-1' } });
    const result = await resolveKey('demo', 'Memoria/Compactación', { repository });
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.canonical_key, 'memory/compaction');
    assert.strictEqual(result.via, 'alias');
  });

  test('returns found:false for unknown key or missing inputs', async () => {
    const repository = buildRepository();
    assert.deepStrictEqual(await resolveKey('demo', 'nope/nope', { repository }), { found: false });
    assert.deepStrictEqual(await resolveKey('', 'memory/compaction', { repository }), { found: false });
    assert.deepStrictEqual(await resolveKey('demo', '', { repository }), { found: false });
  });
});
