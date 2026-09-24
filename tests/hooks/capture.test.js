import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createToolHandlers } from '../../src/mcp/tools.js';
import { observationFromTool } from '../../src/hooks/observe.js';

test('capture has no batch or session quota, including revisions after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-capture-'));
  const options = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  let store = await createMemoryStore(options);
  t.after(() => store.close());
  let handlers = createToolHandlers({ store, projectId: 'demo' });
  const proposal = i => ({ topic_key: `capture/test/item-${i}`, trigger: `when testing component ${i}`, behavior_delta: `Check component ${i}.`, why: 'Regression protection.', evidence_refs: [{ source_type: 'file', source_ref: 'test.js', summary: 'Test evidence' }] });
  const batch = JSON.parse((await handlers.propose({ proposals: Array.from({ length: 8 }, (_, i) => proposal(i)), session_id: 's' })).content[0].text);
  assert.equal(batch.proposals.length, 8);
  assert.ok(batch.proposals.every(p => p.lifecycle_state === 'candidate'));
  await store.claimCapturePrompt('demo', 's');
  const last = JSON.parse((await handlers.propose({ proposals: [proposal(8)], session_id: 's' })).content[0].text);
  assert.equal(last.proposals[0].lifecycle_state, 'candidate');
  store.close();
  store = await createMemoryStore(options);
  handlers = createToolHandlers({ store, projectId: 'demo' });
  const revision = JSON.parse((await handlers.propose({ proposals: [{ ...proposal(0), why: 'Updated evidence after more work.' }], session_id: 's' })).content[0].text);
  assert.equal(revision.proposals[0].decision, 'write');
  const duplicate = JSON.parse((await handlers.propose({ proposals: [proposal(1)], session_id: 's' })).content[0].text);
  assert.equal(duplicate.proposals[0].decision, 'ignore');
  assert.equal(duplicate.proposals[0].id, batch.proposals[1].id);
  assert.equal((await handlers.propose({ proposals: [], session_id: 's' })).isError, true);
  const further = JSON.parse((await handlers.propose({ proposals: [proposal(9)], session_id: 's' })).content[0].text);
  assert.equal(further.proposals[0].decision, 'write');
  assert.equal(await store.countAtoms({ projectId: 'demo' }), 11);
});

test('automatic capture reminders are atomic, isolated and reset per turn without forgetting offered evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-capture-prompts-'));
  const options = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  let store = await createMemoryStore(options);
  t.after(() => store.close());
  const observations = [{ id: 'first' }, { id: 'second' }];
  assert.deepEqual(await Promise.all([store.claimCapturePrompt('demo', 's', observations), store.claimCapturePrompt('demo', 's', observations)]), [true, false]);
  await store.beginCaptureTurn('demo', 's');
  assert.equal(await store.claimCapturePrompt('demo', 's', [...observations].reverse()), false);
  assert.equal(await store.claimCapturePrompt('demo', 's', [...observations, { id: 'new' }]), true);
  assert.equal(await store.claimCapturePrompt('other', 's', observations), true);
  assert.equal(await store.claimCapturePrompt('demo', 'other', observations), true);
  store.close();
  store = await createMemoryStore(options);
  assert.equal(await store.claimCapturePrompt('demo', 's', [{ id: 'later-in-same-turn' }]), false);
  await store.beginCaptureTurn('demo', 's');
  assert.equal(await store.claimCapturePrompt('demo', 's', [{ id: 'next-turn' }]), true);
});

test('ordinary tool output is not captured; failures and explicit validation are bounded', () => {
  assert.equal(observationFromTool({ tool_name: 'Read', tool_response: { output: 'entire file contents' } }), null);
  const failed = observationFromTool({ tool_name: 'Bash', tool_response: { exit_code: 1, stderr: 'token=private-value failure' } });
  assert.equal(failed.metadata.provenance, 'host');
  assert.doesNotMatch(failed.raw_preview, /private-value/);
  assert.ok(observationFromTool({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exit_code: 0 } }));
  assert.equal(observationFromTool({ tool_name: 'Bash', tool_input: { command: 'cat file' }, tool_response: { exit_code: 0 } }), null);
});

// Shapes recorded from a real Claude Code session (2026-09-24): a successful
// Bash call carries no exit code, and a failing one fires PostToolUseFailure
// with an error string instead of PostToolUse.
test('Claude Code outcomes are read from the event, not from an exit code', () => {
  const claudeCode = { claudeCode: true };
  const passed = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { stdout: 'pass 42', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } };
  const validation = observationFromTool(passed, claudeCode);
  assert.equal(validation.source_type, 'validation');
  assert.equal(validation.metadata.exit_code, null);
  assert.match(validation.raw_preview, /^Validation passed \(PostToolUse\)/);
  assert.equal(observationFromTool({ ...passed, tool_input: { command: 'cat file' } }, claudeCode), null);
  assert.equal(observationFromTool({ ...passed, tool_response: { ...passed.tool_response, interrupted: true } }, claudeCode), null);
  // Another host sending the same event is not assumed to share its meaning.
  assert.equal(observationFromTool(passed), null);

  const failed = observationFromTool({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' },
    error: 'Exit code 3\nnot ok 1 token=private-value', is_timeout: false }, claudeCode);
  assert.equal(failed.source_type, 'tool_failure');
  assert.match(failed.raw_preview, /^Failed \(PostToolUseFailure\)\. Exit code 3/);
  assert.doesNotMatch(failed.raw_preview, /private-value/);
  assert.equal(observationFromTool({ hook_event_name: 'PostToolUseFailure', tool_name: 'Read', error: 'File does not exist.' }, claudeCode).source_type, 'tool_failure');
});

test('capture evidence references are bounded, session-scoped, inspectable and engine-verified', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-host-evidence-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  for (let i = 0; i < 5; i++) await store.putObservation({ project_id: 'demo', ...observationFromTool({
    tool_name: 'Bash', session_id: i === 4 ? 'other' : 'current', tool_input: { command: 'npm test' }, tool_response: { exit_code: 0, output: 'Checks passed.' } }) });
  const refs = await store.recentObservations('demo', 'current');
  assert.equal(refs.length, 3);
  assert.equal((await store.recentObservations('foreign', 'current')).length, 0);
  const handlers = createToolHandlers({ store, projectId: 'demo' });
  const observed = JSON.parse((await handlers.get({ id: refs[0].id })).content[0].text);
  assert.equal(observed.metadata.session_id, 'current');
  assert.equal(observed.kind, 'observation');
  const result = JSON.parse((await handlers.propose({ session_id: 'current', proposals: [{
    topic_key: 'tests/regression/validation', trigger: 'when validating project changes', behavior_delta: 'Run the regression suite.', why: 'Catch broken contracts.',
    evidence_refs: [{ source_type: 'tool_output', source_ref: refs[0].id, summary: 'Observed host validation.' }] }] })).content[0].text);
  assert.equal(result.proposals[0].evidence_verified, 1);
  assert.equal(result.proposals[0].lifecycle_state, 'candidate');
  assert.equal((await createToolHandlers({ store, projectId: 'foreign' }).get({ id: refs[0].id })).isError, true);
});
