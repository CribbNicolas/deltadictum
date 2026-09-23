import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../../src/store/create-store.js';
import { proposeMemory } from '../../../src/engine/write.js';
import { retrieveMemories } from '../../../src/engine/retrieve.js';
import { admitMemory, HUMAN_REVIEW } from '../../../src/engine/lifecycle.js';
import { buildSessionStartContext } from '../../../src/hooks/session-start.js';
import { estimateTokens } from '../../../src/engine/budget.js';

// Regressions found against real stores (2026-09-22): reviewed memories that
// could never be injected, or only outside the moment they applied to.
async function fixture(t, fields = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dd-reach-'));
  await writeFile(join(root, 'ARCHITECTURE.md'), 'Layers: domain, application, infrastructure, client.');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  const proposal = { project_id: 'demo', memory_type: 'decision', topic_key: 'architecture/core/layers',
    trigger: 'when adding game logic, commands or presentation',
    behavior_delta: 'Keep domain, application, infrastructure and client separate.',
    why: 'Rules and invariants live in domain; the UI sends commands and reads views.',
    evidence_refs: [{ source_type: 'file', source_ref: 'ARCHITECTURE.md', summary: 'Documented layers' }], ...fields };
  const proposed = await proposeMemory(proposal, { store });
  const atom = await admitMemory(proposed.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Matches the documented architecture.' });
  const retrieve = request => retrieveMemories({ project_id: 'demo', telemetry: false, ...request }, { store });
  return { root, store, atom, retrieve };
}

test('a memory longer than one sentence is still injected when it applies', async t => {
  const long = 'Keep rules and invariants in domain, transactions and views in application, JSON, saves and catalogues in infrastructure, and Godot input and rendering in client; the UI sends commands and reads GameView, never a mutable GameState.';
  const f = await fixture(t, { behavior_delta: long });
  const recalled = await f.retrieve({ action: 'when adding game logic, commands or presentation' });
  assert.equal(recalled.memories[0]?.id, f.atom.id);
  assert.match(recalled.memories[0].content, /never a mutable GameState/);
  assert.ok(estimateTokens(recalled) <= 600);
});

test('an operation outside the declared ones does not exclude a file-scoped memory', async t => {
  const f = await fixture(t, { applies_to: { files: ['src/domain/**'], operations: ['implement', 'review'] } });
  const editing = await f.retrieve({ action: 'Edit {"file_path":"src/domain/Combat/Resolver.cs"}', files: ['src/domain/Combat/Resolver.cs'], operation: 'edit' });
  assert.equal(editing.memories[0]?.id, f.atom.id);
  // The file scope was verified by the request, so it is not restated.
  assert.doesNotMatch(editing.memories[0].content, /Only within: files/);
  const elsewhere = await f.retrieve({ action: 'Edit {"file_path":"tools/build.ps1"}', files: ['tools/build.ps1'], operation: 'edit' });
  assert.equal(elsewhere.memories.length, 0);
  // Recalled by its trigger alone, the unverified scope still travels with it.
  const byTrigger = await f.retrieve({ action: 'when adding game logic, commands or presentation' });
  assert.match(byTrigger.memories[0].content, /Only within: files: src\/domain\/\*\*/);
});

test('changed evidence keeps the advice visible, flagged for review', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'ARCHITECTURE.md'), 'Layers were reorganised.');
  const recalled = await f.retrieve({ action: 'when adding game logic, commands or presentation' });
  assert.equal(recalled.memories[0].lifecycle_state, 'review_required');
  assert.match(recalled.memories[0].content, /Keep domain, application, infrastructure and client separate/);
  assert.match(recalled.memories[0].content, /evidence changed/i);
});

test('memories tagged ambient reach every session once, at session start', async t => {
  const f = await fixture(t, { tags: ['ambient'] });
  const start = await buildSessionStartContext({ store: f.store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 's1' });
  assert.match(start.hookSpecificOutput.additionalContext, /Keep domain, application, infrastructure and client separate/);
  // Already delivered in this session: the tool-call path does not repeat it.
  const later = await f.retrieve({ action: 'when adding game logic, commands or presentation', session_id: 's1' });
  assert.equal(later.memories.length, 0);
});

test('a memory delivered once in a session is not repeated because the next call is shaped differently', async t => {
  const f = await fixture(t, { applies_to: { files: ['src/domain/**'], operations: ['implement'] } });
  const first = await f.retrieve({ action: 'Edit {"file_path":"src/domain/a.cs"}', files: ['src/domain/a.cs'], operation: 'edit', session_id: 'same' });
  assert.equal(first.memories.length, 1);
  const second = await f.retrieve({ action: 'when adding game logic, commands or presentation', session_id: 'same' });
  assert.equal(second.memories.length, 0);
});

test('when full forms do not fit, the remaining applicable memories still arrive as headlines', async t => {
  const long = sentence => `${sentence} ${'Supporting detail about the layers and why they stay apart. '.repeat(25)}`;
  const f = await fixture(t, { behavior_delta: long('Keep domain, application, infrastructure and client separate.') });
  const second = await proposeMemory({ project_id: 'demo', memory_type: 'decision', topic_key: 'architecture/core/commands',
    trigger: 'when a player action changes game state',
    behavior_delta: long('Route every player action through a command handler.'), why: 'Commands are the only mutation path.',
    evidence_refs: [{ source_type: 'file', source_ref: 'ARCHITECTURE.md', summary: 'Documented layers' }] }, { store: f.store });
  await admitMemory(second.atom.id, { store: f.store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Documented.' });
  const recalled = await f.retrieve({ action: 'when adding game logic, commands or presentation so a player action changes game state' });
  assert.equal(recalled.memories.length, 2);
  const headline = recalled.memories.find(m => m.form_type === 'headline');
  assert.ok(headline);
  assert.ok(headline.content.length < 260);
  assert.match(headline.content, /get .* for the full advice/);
  assert.match(headline.content, /^(Keep domain, application, infrastructure and client separate\.|Route every player action through a command handler\.) \(get /);
  assert.ok(estimateTokens(recalled) <= 600);
});

test('two tool calls in parallel deliver a memory once in a session', async t => {
  const f = await fixture(t);
  const request = { action: 'when adding game logic, commands or presentation', session_id: 'parallel' };
  const results = await Promise.all([f.retrieve(request), f.retrieve(request), f.retrieve(request)]);
  assert.equal(results.reduce((n, r) => n + r.memories.length, 0), 1);
});
