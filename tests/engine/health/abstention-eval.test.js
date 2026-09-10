import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../../src/store/create-store.js';
import { retrieveMemories } from '../../../src/engine/retrieve.js';

const NOW = '2026-09-10T00:00:00.000Z';

function lesson(overrides) {
  return {
    project_id: 'demo',
    memory_type: 'lesson',
    scope: 'project',
    authority: 'inferred',
    confidence: 0.8,
    valid_from: NOW,
    created_at: NOW,
    updated_at: NOW,
    lifecycle_state: 'active',
    tags: [],
    evidence_refs: [{ source_type: 'file', source_ref: 'tests/engine/health/abstention-eval.test.js', summary: 'eval fixture' }],
    retrieval_forms: {
      micro: overrides.title,
      short: overrides.behavior_delta,
    },
    ...overrides,
  };
}

const FIXTURES = [
  lesson({
    id: 'inj-1',
    title: 'Require trigger',
    topic_key: 'eval/inject/required-fields',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first',
    what: 'Durable memory needs a trigger.',
    why: 'Stops V1 dumps.',
  }),
  lesson({
    id: 'inj-2',
    title: 'Git hooks',
    topic_key: 'eval/inject/git-hooks',
    trigger: 'when installing git hooks',
    behavior_delta: 'keep hook runners thin',
    what: 'Git hooks should stay thin.',
    why: 'Avoids host lock-in.',
  }),
  lesson({
    id: 'inj-3',
    title: 'Postgres migrations',
    topic_key: 'eval/inject/pg-migrations',
    trigger: 'when editing postgres migrations',
    behavior_delta: 'keep migrations forward-only',
    what: 'Do not rewrite applied migrations.',
    why: 'Prevents drift.',
  }),
  lesson({
    id: 'inj-4',
    memory_type: 'anti_memory',
    title: 'Reject think tags',
    topic_key: 'eval/inject/think-tags',
    trigger: 'when raw model output contains think tags',
    behavior_delta: 'do not store raw think blocks as active memory',
    what: 'Think tags are unsafe.',
    why: 'Poisoning.',
  }),
  lesson({
    id: 'inj-5',
    title: 'Project filter',
    topic_key: 'eval/inject/project-filter',
    trigger: 'when listing memories from another project',
    behavior_delta: 'always filter retrieve by project_id first',
    what: 'Retrieval is project-scoped.',
    why: 'INV-06.',
  }),
  lesson({
    id: 'inj-6',
    title: 'Compact MCP JSON',
    topic_key: 'eval/inject/compact-json',
    trigger: 'when serializing MCP retrieve results',
    behavior_delta: 'emit compact JSON without pretty-print',
    what: 'Pretty-print inflates tool tokens.',
    why: 'The model reads the tool payload.',
  }),
  lesson({
    id: 'inj-7',
    title: 'Plugin tests',
    topic_key: 'eval/inject/plugin-tests',
    trigger: 'when running unit tests in this plugin',
    behavior_delta: 'run npm test then npm run test:stress',
    what: 'Gate plus stress.',
    why: 'Scale bugs hide in unit tests.',
  }),
  lesson({
    id: 'inj-8',
    title: 'Audit UI',
    topic_key: 'eval/inject/audit-ui',
    trigger: 'when opening the audit UI',
    behavior_delta: 'use supermem_ui for the local URL',
    what: 'Audit is local HTTP.',
    why: 'Humans edit memories.',
  }),
  lesson({
    id: 'inj-9',
    title: 'Live topic uniqueness',
    topic_key: 'eval/inject/live-topic',
    trigger: 'when a topic key collides on write',
    behavior_delta: 'supersede or update the live atom, do not dual-write',
    what: 'One live atom per topic_key.',
    why: 'Unique index.',
  }),
  lesson({
    id: 'inj-10',
    title: 'Budget abstain',
    topic_key: 'eval/inject/budget-abstain',
    trigger: 'when the retrieve budget is exhausted',
    behavior_delta: 'stop injecting and leave remaining candidates out',
    what: 'Budget is a hard stop.',
    why: 'Context explosion.',
  }),
];

const SHOULD_INJECT = [
  { action: 'before writing durable memory', id: 'inj-1' },
  { action: 'when installing git hooks', id: 'inj-2' },
  { action: 'when editing postgres migrations', id: 'inj-3' },
  { action: 'when raw model output contains think tags', id: 'inj-4' },
  { action: 'when listing memories from another project', id: 'inj-5' },
  { action: 'when serializing MCP retrieve results', id: 'inj-6' },
  { action: 'when running unit tests in this plugin', id: 'inj-7' },
  { action: 'when opening the audit UI', id: 'inj-8' },
  { action: 'when a topic key collides on write', id: 'inj-9' },
  { action: 'when the retrieve budget is exhausted', id: 'inj-10' },
];

const SHOULD_ABSTAIN = [
  { action: 'unrelated cooking recipe' },
  { action: 'tell me a joke' },
  { action: 'what is two plus two' },
  { action: 'refactor css colors' },
  { action: 'install rust nightly' },
  { action: 'weather in madrid' },
  { action: 'summarize this pdf' },
  { action: 'before writing tests' },
  { action: 'deploy frontend assets' },
  { action: 'rotate database credentials' },
];

describe('abstention eval harness', () => {
  test('F1 of should-inject vs should-abstain is at least 0.8', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-eval-'));
    const store = await createMemoryStore({
      supermemDir: join(root, '.supermem'),
      dataDir: join(root, 'data'),
    });
    for (const atom of FIXTURES) store.index.upsertAtom(atom);

    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const row of SHOULD_INJECT) {
      const retrieved = await retrieveMemories({
        project_id: 'demo',
        action: row.action,
      }, { store });
      const hit = retrieved.memories.some(memory => memory.id === row.id);
      if (hit) tp += 1;
      else fn += 1;
    }
    for (const row of SHOULD_ABSTAIN) {
      const retrieved = await retrieveMemories({
        project_id: 'demo',
        action: row.action,
      }, { store });
      if (retrieved.abstained || retrieved.memories.length === 0) tn += 1;
      else fp += 1;
    }

    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    assert.ok(f1 >= 0.8, `F1 ${f1.toFixed(3)} (tp=${tp} fp=${fp} fn=${fn} tn=${tn})`);
    store.close();
  });
});
