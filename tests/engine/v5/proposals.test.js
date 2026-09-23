import { describe, test } from 'node:test';
import assert from 'node:assert';
import { gateProposal, applyProposal } from '../../../src/engine/v5/proposals.js';

function buildRepository({ entries = {}, aliases = {}, vocab = {} } = {}) {
  const calls = [];
  const repository = {
    calls,
    getRegistryEntryByKey: async (p, key) => entries[key] ?? null,
    getAliasByName: async (p, alias) => aliases[alias] ?? null,
    getVocabularyValue: async (p, kind, value) => vocab[`${kind}:${value}`] ?? null,
    createRegistryEntry: async (...args) => { calls.push(['createRegistryEntry', ...args]); return { id: 'new-reg' }; },
    createAlias: async (...args) => { calls.push(['createAlias', ...args]); return { id: 'new-alias' }; },
    createVocabularyValue: async (...args) => { calls.push(['createVocabularyValue', ...args]); return { id: 'new-vocab' }; },
    updateRegistryStatus: async (...args) => { calls.push(['updateRegistryStatus', ...args]); return { id: 'reg-1' }; },
    renameRegistryEntry: async (...args) => { calls.push(['renameRegistryEntry', ...args]); return { id: 'reg-1' }; },
  };
  return repository;
}

const provisional = { id: 'reg-1', canonical_key: 'memory/compaction', status: 'provisional' };
const canonical = { id: 'reg-2', canonical_key: 'queue/dlq', status: 'canonical' };

describe('V5 proposal gate', () => {
  test('new_key with valid free key auto-approves', async () => {
    const repository = buildRepository();
    assert.deepStrictEqual(
      await gateProposal({ project_id: 'demo', proposal_type: 'new_key', payload: { key: 'memory/registry' } }, { repository }),
      { status: 'auto_approved' },
    );
  });

  test('new_key rejects on bad format, existing key, alias collision', async () => {
    const repository = buildRepository({
      entries: { 'memory/compaction': provisional },
      aliases: { 'queue/cola': { registry_id: 'reg-2' } },
    });
    assert.strictEqual((await gateProposal({ project_id: 'demo', proposal_type: 'new_key', payload: { key: 'solo' } }, { repository })).status, 'rejected');
    assert.deepStrictEqual(
      await gateProposal({ project_id: 'demo', proposal_type: 'new_key', payload: { key: 'memory/compaction' } }, { repository }),
      { status: 'rejected', reason: 'key_exists' },
    );
    assert.deepStrictEqual(
      await gateProposal({ project_id: 'demo', proposal_type: 'new_key', payload: { key: 'queue/cola' } }, { repository }),
      { status: 'rejected', reason: 'key_collides_with_alias' },
    );
  });

  test('alias_add: provisional target auto-approves, canonical target pends, collision rejects', async () => {
    const repository = buildRepository({ entries: { 'memory/compaction': provisional, 'queue/dlq': canonical } });
    assert.deepStrictEqual(
      await gateProposal({ project_id: 'demo', proposal_type: 'alias_add', payload: { target_key: 'memory/compaction', alias: 'memoria/compactacion' } }, { repository }),
      { status: 'auto_approved' },
    );
    assert.deepStrictEqual(
      await gateProposal({ project_id: 'demo', proposal_type: 'alias_add', payload: { target_key: 'queue/dlq', alias: 'queue/dead-letter' } }, { repository }),
      { status: 'pending' },
    );
    assert.deepStrictEqual(
      await gateProposal({ project_id: 'demo', proposal_type: 'alias_add', payload: { target_key: 'memory/compaction', alias: 'queue/dlq' } }, { repository }),
      { status: 'rejected', reason: 'alias_collision' },
    );
  });

  test('vocab_add: tag auto-approves, domain pends, duplicate/invalid rejects', async () => {
    const repository = buildRepository({ vocab: { 'tag:infra': { id: 'v1' } } });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'vocab_add', payload: { kind: 'tag', value: 'testing' } }, { repository }), { status: 'auto_approved' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'vocab_add', payload: { kind: 'domain', value: 'agents' } }, { repository }), { status: 'pending' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'vocab_add', payload: { kind: 'tag', value: 'infra' } }, { repository }), { status: 'rejected', reason: 'vocab_exists' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'vocab_add', payload: { kind: 'tag', value: 'Bad Value' } }, { repository }), { status: 'rejected', reason: 'invalid_vocab_value' });
  });

  test('promote/deprecate/rename pend on known target, reject unknown target or collision', async () => {
    const repository = buildRepository({ entries: { 'memory/compaction': provisional, 'queue/dlq': canonical } });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'promote', payload: { target_key: 'memory/compaction' } }, { repository }), { status: 'pending' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'deprecate', payload: { target_key: 'queue/dlq' } }, { repository }), { status: 'pending' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'promote', payload: { target_key: 'nope/nope' } }, { repository }), { status: 'rejected', reason: 'unknown_target' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'rename', payload: { target_key: 'memory/compaction', new_key: 'memory/compactor' } }, { repository }), { status: 'pending' });
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'rename', payload: { target_key: 'memory/compaction', new_key: 'queue/dlq' } }, { repository }), { status: 'rejected', reason: 'key_collision' });
  });

  test('invalid proposal_type and missing project_id reject', async () => {
    const repository = buildRepository();
    assert.deepStrictEqual(await gateProposal({ project_id: 'demo', proposal_type: 'magic', payload: {} }, { repository }), { status: 'rejected', reason: 'invalid_proposal_type' });
    assert.deepStrictEqual(await gateProposal({ proposal_type: 'new_key', payload: { key: 'a/b' } }, { repository }), { status: 'rejected', reason: 'missing_project_id' });
  });
});

describe('V5 proposal apply', () => {
  test('rename updates canonical_key and records old key as rename alias', async () => {
    const repository = buildRepository({ entries: { 'memory/compaction': provisional } });
    await applyProposal({ project_id: 'demo', proposal_type: 'rename', payload: { target_key: 'memory/compaction', new_key: 'memory/compactor' } }, { repository });
    assert.deepStrictEqual(repository.calls[0], ['renameRegistryEntry', 'reg-1', 'memory/compactor']);
    assert.deepStrictEqual(repository.calls[1], ['createAlias', 'reg-1', 'demo', 'memory/compaction', 'rename', null]);
  });

  test('new_key creates provisional entry; alias_add creates alias with kind/lang', async () => {
    const repository = buildRepository({ entries: { 'memory/compaction': provisional } });
    await applyProposal({ project_id: 'demo', proposal_type: 'new_key', payload: { key: 'memory/registry' } }, { repository });
    assert.deepStrictEqual(repository.calls[0], ['createRegistryEntry', 'demo', 'memory/registry', 'provisional']);

    await applyProposal({ project_id: 'demo', proposal_type: 'alias_add', payload: { target_key: 'memory/compaction', alias: 'memoria/compactacion', kind: 'translation', lang: 'es' } }, { repository });
    assert.deepStrictEqual(repository.calls[1], ['createAlias', 'reg-1', 'demo', 'memoria/compactacion', 'translation', 'es']);
  });

  test('promote/deprecate update status; vocab_add creates value', async () => {
    const repository = buildRepository({ entries: { 'memory/compaction': provisional } });
    await applyProposal({ project_id: 'demo', proposal_type: 'promote', payload: { target_key: 'memory/compaction' } }, { repository });
    assert.deepStrictEqual(repository.calls[0], ['updateRegistryStatus', 'demo', 'memory/compaction', 'canonical']);

    await applyProposal({ project_id: 'demo', proposal_type: 'deprecate', payload: { target_key: 'memory/compaction' } }, { repository });
    assert.deepStrictEqual(repository.calls[1], ['updateRegistryStatus', 'demo', 'memory/compaction', 'deprecated']);

    await applyProposal({ project_id: 'demo', proposal_type: 'vocab_add', payload: { kind: 'tag', value: 'testing' } }, { repository });
    assert.deepStrictEqual(repository.calls[2], ['createVocabularyValue', 'demo', 'tag', 'testing']);
  });
});
