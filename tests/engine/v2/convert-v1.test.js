import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY_MAX, convertV1 } from '../../../src/memory/convert-v1.js';

const atom = (over = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000001', project_id: 'p', schema_version: 7,
  capture_origin: 'model_initiated', capture_source: 'agent', memory_type: 'lesson', scope: 'project',
  title: 'Close stores in t.after', topic_key: 'testing/store-handle', trigger: 'when a test opens a store',
  behavior_delta: 'Close stores in t.after.', what: 'Close stores in t.after.', why: 'A failing assertion left the file hanging.',
  tags: ['x'], trigger_variants: ['y'],
  applies_to: { files: ['tests/mcp/tools.test.js', 'src\\store\\create-store.js'], components: ['tests'], operations: ['test'] },
  anchors: { keywords: ['se cuelga', 'never finishes'], not_when: ['production'], files: ['tests/mcp/tools.test.js'] },
  assumptions: [], revisit_when: [{ kind: 'manual', description: 'If node --test changes.' }],
  alternatives: [{ option: 'test-force-exit', reason: 'crashes resident tests' }],
  evidence_refs: [
    { source_type: 'file', source_ref: 'tests/mcp/tools.test.js#L10-L20', summary: 'the test' },
    { source_type: 'tool_output', source_ref: 'obs-1', summary: 'timed out' },
    { source_type: 'user_statement', source_ref: 'UserPromptSubmit', summary: 'said so' },
  ],
  evidence_state: { artifacts: [{ source_type: 'file', source_ref: 'tests/mcp/tools.test.js#L10-L20', status: 'verified', provenance: 'filesystem', hash: 'abc' }] },
  authority: 'validated', lifecycle_state: 'active', confidence: 0.765, activation_count: 3, retrieval_forms: {},
  replaces: 'old-id', created_at: '2026-09-22T00:00:00.000Z', updated_at: '2026-09-23T00:00:00.000Z',
  ...over,
});

test('a v1 lesson becomes a trap whose body is the advice, its reason and the alternatives', () => {
  const m = convertV1(atom());
  assert.equal(m.schema_version, 8);
  assert.equal(m.kind, 'trap');
  assert.equal(m.status, 'active');
  assert.equal(m.topic, 'testing/store-handle');
  assert.equal(m.body, 'Close stores in t.after.\n\nWhy: A failing assertion left the file hanging.\n\nAlternatives considered: test-force-exit (crashes resident tests)');
  assert.equal(m.not_derivable, '');
  assert.equal(m.origin, 'model_initiated');
  assert.equal(m.replaces, 'old-id');
  assert.deepEqual(m.review, { migrated: true, issues: ['not_derivable_missing'] });
  assert.equal(m.created, '2026-09-22T00:00:00.000Z');
  assert.equal(m.updated, '2026-09-23T00:00:00.000Z');
});

test('scope files and anchors become a path clause and a keyword clause', () => {
  assert.deepEqual(convertV1(atom()).triggers, [
    { on: ['read', 'edit', 'write'], paths: ['tests/mcp/tools.test.js', 'src/store/create-store.js'] },
    { on: ['prompt', 'search'], keywords: ['se cuelga', 'never finishes'], not: ['production'] },
  ]);
});

test('evidence keeps verified file hashes and copies observations and user statements in', () => {
  assert.deepEqual(convertV1(atom()).evidence, [
    { type: 'file', path: 'tests/mcp/tools.test.js', sha256: 'abc', summary: 'the test' },
    { type: 'observation', ref: 'obs-1', summary: 'timed out' },
    { type: 'correction', ref: 'UserPromptSubmit', summary: 'said so' },
  ]);
});

test('fields v2 drops are gone', () => {
  const m = convertV1(atom());
  for (const field of ['confidence', 'retrieval_forms', 'tags', 'trigger_variants', 'scope', 'activation_count', 'anchors', 'applies_to', 'behavior_delta', 'lifecycle_state', 'topic_key']) {
    assert.equal(field in m, false, field);
  }
});

test('kinds and statuses map as the spec says', () => {
  assert.equal(convertV1(atom({ memory_type: 'decision' })).kind, 'decision');
  assert.equal(convertV1(atom({ memory_type: 'claim' })).kind, 'fact');
  assert.equal(convertV1(atom({ memory_type: 'procedure' })).kind, 'procedure');
  assert.equal(convertV1(atom({ memory_type: 'anti_memory' })).kind, 'trap');
  assert.equal(convertV1(atom({ lifecycle_state: 'candidate' })).status, 'candidate');
  assert.equal(convertV1(atom({ lifecycle_state: 'contested' })).status, 'contested');
  assert.equal(convertV1(atom({ lifecycle_state: 'superseded' })).status, 'superseded');
  assert.equal(convertV1(atom({ lifecycle_state: 'rejected' })).status, 'archived');
  assert.equal(convertV1(atom({ capture_origin: 'user_explicit' })).origin, 'user_explicit');
});

test('a legacy memory becomes an active failed approach on its own topic', () => {
  const titles = new Map([['new-id', 'Read the data directory from deltadictum status']]);
  const m = convertV1(atom({ lifecycle_state: 'legacy', legacy_reason: 'The resident replaced ui.json.', replaced_by: 'new-id' }), { titles });
  assert.equal(m.kind, 'failed_approach');
  assert.equal(m.status, 'active');
  // Its own topic, unique even when two abandoned approaches share the v1 topic.
  assert.equal(m.topic, 'testing/store-handle-abandoned-a1b2c3d4');
  assert.equal(m.body, 'No longer done: Close stores in t.after.\n\nAbandoned because: The resident replaced ui.json.\n\nNow: Read the data directory from deltadictum status');
  const orphan = convertV1(atom({ lifecycle_state: 'legacy', legacy_reason: 'x', replaced_by: null }));
  assert.match(orphan.body, /Now: no replacement recorded$/);
});

test('a reference that is not a repository path never becomes file evidence', () => {
  const m = convertV1(atom({ evidence_refs: [
    { source_type: 'diff', source_ref: 'commit 39af05c', summary: 'the fix' },
    { source_type: 'test_log', source_ref: 'npm test', summary: 'green' },
    { source_type: 'file', source_ref: 'src/hooks/banner.js sessionBanner()', summary: 'the banner' },
  ], evidence_state: { artifacts: [] } }));
  assert.deepEqual(m.evidence, [
    { type: 'note', ref: 'commit 39af05c', summary: 'the fix' },
    { type: 'note', ref: 'npm test', summary: 'green' },
    { type: 'file', path: 'src/hooks/banner.js', summary: 'sessionBanner(): the banner' },
  ]);
  assert.ok(m.review.issues.includes('evidence_not_a_path'));
});

test('a legacy memory names the live memory on its topic when v1 recorded no replacement', () => {
  const live = new Map([['testing/store-handle', 'Close stores in t.after, the current way']]);
  const m = convertV1(atom({ lifecycle_state: 'legacy', legacy_reason: 'Superseded.', replaced_by: null }), { liveByTopic: live });
  assert.match(m.body, /Now: Close stores in t\.after, the current way$/);
  assert.ok(!m.review.issues.includes('replacement_unknown'));
  const orphan = convertV1(atom({ lifecycle_state: 'legacy', legacy_reason: 'x', replaced_by: null }));
  assert.ok(orphan.review.issues.includes('replacement_unknown'));
});

test('a v1 folder scope is flagged for review, never turned into a trigger', () => {
  // A whole folder fires on most work: tests/** reached 52% of the bench's runs.
  const m = convertV1(atom({ anchors: {}, applies_to: { files: ['skills/', 'tests\\', 'src/a.js'] } }));
  assert.deepEqual(m.triggers, [{ on: ['read', 'edit', 'write'], paths: ['src/a.js'] }]);
  assert.ok(m.review.issues.includes('folder_scope'));
  const onlyFolder = convertV1(atom({ anchors: {}, applies_to: { files: ['tests/'] } }));
  assert.deepEqual(onlyFolder.triggers, []);
  assert.ok(onlyFolder.review.issues.includes('no_triggers'));
});

test('a long body is converted whole and flagged; a memory with no trigger is flagged', () => {
  const long = convertV1(atom({ why: 'w'.repeat(BODY_MAX) }));
  assert.ok(long.body.length > BODY_MAX);
  assert.ok(long.review.issues.includes('body_too_long'));
  const bare = convertV1(atom({ anchors: {}, applies_to: { files: [] } }));
  assert.deepEqual(bare.triggers, []);
  assert.ok(bare.review.issues.includes('no_triggers'));
});
