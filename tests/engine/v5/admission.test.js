import { describe, test } from 'node:test';
import assert from 'node:assert';
import { prepareV5Write } from '../../../src/engine/v5/admission.js';

const vocab = { domains: ['memory'], tags: ['infra'] };

function buildRepository({ entries = {}, aliases = {} } = {}) {
  return {
    getVocabulary: async () => vocab,
    getRegistryEntryByKey: async (p, key) => entries[key] ?? null,
    getAliasByName: async (p, alias) => aliases[alias] ?? null,
    getRegistryEntryById: async id => Object.values(entries).find(e => e.id === id) ?? null,
    getAliasesForRegistry: async () => [],
  };
}

describe('V5 prepareV5Write', () => {
  test('substitutes alias with canonical key and reuses registry id', async () => {
    const repository = buildRepository({
      entries: { 'memory/compaction': { id: 'reg-1', canonical_key: 'memory/compaction', status: 'canonical', notes: null } },
      aliases: { 'memoria/compactacion': { registry_id: 'reg-1' } },
    });
    const result = await prepareV5Write({ project_id: 'orquesta', topic_key: 'Memoria/Compactación', tags: ['infra'] }, { repository });
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.payload.topic_key, 'memory/compaction');
    assert.strictEqual(result.registry_key_id, 'reg-1');
    assert.strictEqual(result.needs_registration, false);
  });

  test('unknown key passes vocab validation and flags needs_registration', async () => {
    const repository = buildRepository();
    const result = await prepareV5Write({ project_id: 'orquesta', topic_key: 'memory/registry', tags: [] }, { repository });
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.payload.topic_key, 'memory/registry');
    assert.strictEqual(result.registry_key_id, null);
    assert.strictEqual(result.needs_registration, true);
  });

  test('rejects unknown domain, unknown tag, bad format with 422', async () => {
    const repository = buildRepository();
    assert.deepStrictEqual(
      (await prepareV5Write({ project_id: 'orquesta', topic_key: 'agents/routing', tags: [] }, { repository })).error,
      { code: 422, message: 'unknown_domain' },
    );
    assert.deepStrictEqual(
      (await prepareV5Write({ project_id: 'orquesta', topic_key: 'memory/registry', tags: ['nope'] }, { repository })).error,
      { code: 422, message: 'unknown_tag' },
    );
    assert.deepStrictEqual(
      (await prepareV5Write({ project_id: 'orquesta', topic_key: 'solo', tags: [] }, { repository })).error,
      { code: 422, message: 'invalid_key_format' },
    );
  });

  test('rejects write to deprecated key with notes in error', async () => {
    const repository = buildRepository({
      entries: { 'memory/old': { id: 'reg-9', canonical_key: 'memory/old', status: 'deprecated', notes: 'use memory/new' } },
    });
    const result = await prepareV5Write({ project_id: 'orquesta', topic_key: 'memory/old', tags: [] }, { repository });
    assert.deepStrictEqual(result.error, { code: 422, message: 'topic_key_deprecated', notes: 'use memory/new' });
  });
});
