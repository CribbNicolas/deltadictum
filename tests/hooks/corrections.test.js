import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createToolHandlers } from '../../src/mcp/tools.js';
import { startUiServer } from '../../src/ui/server.js';
import { observationFromPrompt, recordPromptObservation } from '../../src/hooks/observe.js';
import { RELIABILITY_CAP } from '../../src/engine/reliability.js';

// Hook processes spawned here must not start a resident DD process (src/resident.js).
process.env.DD_RESIDENT = '0';
// No resident here: these tests exercise the hooks in the explicit lexical mode.
process.env.DD_RETRIEVAL = 'lexical';

const hookPath = fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url));
function hook(root, command, payload, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath, command, ...extra, '--data', join(root, '.dd/local')],
      { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.once('error', reject);
    child.once('close', code => code ? reject(new Error(`hook_failed:${code}`)) : resolve(output.trim() ? JSON.parse(output) : {}));
    child.stdin.end(JSON.stringify({ cwd: root, session_id: 'corrections', ...payload }));
  });
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'dd-corrections-'));
  await mkdir(join(root, '.dd'), { recursive: true });
  await writeFile(join(root, '.dd', 'config.json'), JSON.stringify({ project_id: 'demo' }));
  return root;
}

// Realistic phrasing, not keyword bait: this is how a correction is actually
// typed mid-session, in both languages the codebase already detects.
test('a user correction in English or Spanish is observed', () => {
  for (const prompt of [
    'No, that is wrong - the gate reads reliability before the anti-memory rule.',
    'You broke the eval run. Revert the ranking change.',
    'Use the project-scoped query instead of scanning every atom.',
    'I told you not to touch the schema file.',
    'That is not what I asked for; the hook must stay advisory.',
    'Stop editing the plan and read src/ first.',
    'Wrong file - the surfacing lives in run.js.',
    'No, eso esta mal. Revierte el commit anterior.',
    'Te dije que no modifiques el esquema, solo el indice.',
    'No uses una expresion regular aqui, usa el parser existente.',
    'Eso no es lo que pedi: la promocion sigue siendo humana.',
    'Te equivocaste de rama, deshaz ese merge.',
  ]) assert.ok(observationFromPrompt({ prompt }), `missed correction: ${prompt}`);
});

// The test that keeps the review queue usable. A flooded queue makes the top
// reliability rung meaningless, so this list is longer than the positive one and
// deliberately includes ordinary prompts carrying correction-adjacent words.
test('ordinary work is not mistaken for a correction', () => {
  for (const prompt of [
    'Add a test for the prompt observation path.',
    'Do not forget to update the roadmap when this closes.',
    'Run the suite and stop the UI server when it finishes.',
    'Use zod for the tool schema.',
    'No tests exist for this branch yet; please add some.',
    'Implement stage 5 exactly as the plan describes.',
    'It is not clear why verifyReferences returns unreviewed support.',
    'Explain how the retrieval budget is applied.',
    'Continue with the next part of the task.',
    'Commit the change with a message explaining the tradeoff.',
    'Check whether the observation is pruned by retention.',
    'Undoing is not in scope here, just describe the ladder.',
    'Puedes agregar una prueba para el detector?',
    'Necesito que no se rompa el build en Windows.',
    'Haz un resumen de los cambios de esta etapa.',
    'Revisa el archivo de configuracion y dime que falta.',
  ]) assert.equal(observationFromPrompt({ prompt }), null, `false correction: ${prompt}`);
});

test('a correction is redacted and bounded like a tool observation', () => {
  const observation = observationFromPrompt({ prompt: 'No, that is wrong. The failing call used token=hunter2-live and sk-abcdefghijklmnop.' });
  assert.doesNotMatch(observation.raw_preview, /hunter2-live/);
  assert.doesNotMatch(observation.raw_preview, /abcdefghijklmnop/);
  const long = observationFromPrompt({ prompt: `No, that is wrong. ${'detail '.repeat(2000)}` });
  assert.ok(long.raw_preview.length <= 800);
});

test('a correction carries the ladder provenance and assigns no confidence itself', () => {
  const observation = observationFromPrompt({ prompt: 'No, that is wrong. Revert it.', session_id: 's' });
  assert.equal(observation.metadata.provenance, 'user_correction');
  assert.equal(observation.source_type, 'user_correction');
  assert.equal(observation.metadata.session_id, 's');
  assert.equal(observation.confidence, undefined);
  assert.equal(observation.metadata.confidence, undefined);
  assert.equal(observation.metadata.cap, undefined);
});

test('an observed correction verifies as evidence at the ladder provenance', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-correction-evidence-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  await recordPromptObservation({ prompt: 'No, that is wrong - retrieval is project-scoped first, always.', session_id: 'current' },
    { store, projectId: 'demo' });
  const refs = await store.recentObservations('demo', 'current');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].source_type, 'user_correction');
  const handlers = createToolHandlers({ store, projectId: 'demo' });
  const proposed = JSON.parse((await handlers.propose({ session_id: 'current', proposals: [{
    topic_key: 'retrieval/scope/project-first', trigger: 'when retrieving project knowledge', behavior_delta: 'Scope retrieval to the project first.',
    why: 'The user corrected a cross-project fallback.', capture_origin: 'user_explicit',
    evidence_refs: [{ source_type: 'tool_output', source_ref: refs[0].id, summary: 'Observed user correction.' }] }] })).content[0].text);
  assert.equal(proposed.proposals[0].evidence_verified, 1);
  assert.equal(proposed.proposals[0].lifecycle_state, 'candidate');
  const stored = await store.getAtom(proposed.proposals[0].id);
  assert.equal(stored.evidence_state.artifacts[0].provenance, 'user_correction');
  assert.equal(RELIABILITY_CAP.user_correction, 0.95);
});

test('the resident prompt handler still returns its context when the observation write fails', async t => {
  const root = await project();
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  await store.putAtom({ id: 'fixture', project_id: 'demo', topic_key: 'hooks/prompt/context', memory_type: 'lesson', scope: 'project',
    title: 'Prompt context survives', trigger: 'revert the durable memory change', behavior_delta: 'Keep returning retrieval context.',
    what: 'Keep returning retrieval context.', why: 'A hook failure must not damage the turn.', lifecycle_state: 'active',
    authority: 'validated', confidence: 0.85, valid_from: '2026-01-01T00:00:00Z',
    retrieval_forms: { micro: 'Keep returning retrieval context.' } });
  const failing = { ...store, putObservation: async () => { throw new Error('observation_write_failed'); } };
  await recordPromptObservation({ prompt: 'No, that is wrong. Revert the durable memory change.' }, { store: failing, projectId: 'demo' });
  const ui = await startUiServer({ store: failing, projectId: 'demo', port: 0 });
  t.after(() => ui.close());
  const response = await fetch(`${ui.url}/api/hooks/prompt`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dd-hook-token': ui.hookToken },
    body: JSON.stringify({ repo_root: store.repoRoot, payload: { session_id: 'broken', prompt: 'No, that is wrong. Revert the durable memory change.' } }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.hookSpecificOutput.additionalContext, /Keep returning retrieval context/);
});

// Both prompt handlers must record: the standalone hook process here, the
// resident service above. An earlier stage shipped against one of a pair.
test('the standalone prompt hook records the correction and still returns context', async () => {
  const root = await project();
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, '.dd/local') });
  await store.putAtom({ id: 'fixture', project_id: 'demo', topic_key: 'hooks/prompt/standalone', memory_type: 'lesson', scope: 'project',
    title: 'Standalone prompt context', trigger: 'revert the ranking change', behavior_delta: 'Return retrieval context on every prompt.',
    what: 'Return retrieval context.', why: 'The prompt hook owes the turn its context.', lifecycle_state: 'active',
    authority: 'validated', confidence: 0.85, valid_from: '2026-01-01T00:00:00Z',
    retrieval_forms: { micro: 'Return retrieval context on every prompt.' } });
  store.close();
  const context = await hook(root, 'prompt', { prompt: 'No, that is wrong. Revert the ranking change.' });
  assert.match(context.hookSpecificOutput.additionalContext, /Return retrieval context/);
  const reopened = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, '.dd/local') });
  const refs = await reopened.recentObservations('demo', 'corrections');
  reopened.close();
  assert.equal(refs.length, 1);
  assert.equal(refs[0].source_type, 'user_correction');
  const ordinary = await project();
  assert.deepEqual(await hook(ordinary, 'prompt', { prompt: 'Add a test for the parser.' }), {});
});

// The Codex adapter rewrites Stop into a blocking continuation. UserPromptSubmit
// is not rewritten, so the correction path behaves identically under --codex.
test('the Codex path leaves UserPromptSubmit alone', async () => {
  const root = await project();
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, '.dd/local') });
  await store.putAtom({ id: 'fixture', project_id: 'demo', topic_key: 'hooks/prompt/codex', memory_type: 'lesson', scope: 'project',
    title: 'Codex prompt context', trigger: 'revert the codex change', behavior_delta: 'Return retrieval context under Codex too.',
    what: 'Return retrieval context.', why: 'Only Stop is rewritten.', lifecycle_state: 'active',
    authority: 'validated', confidence: 0.85, valid_from: '2026-01-01T00:00:00Z',
    retrieval_forms: { micro: 'Return retrieval context under Codex too.' } });
  store.close();
  const context = await hook(root, 'prompt', { prompt: 'No, that is wrong. Revert the codex change.' }, ['--codex']);
  assert.equal(context.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(context.decision, undefined);
  assert.equal(context.reason, undefined);
});

// The Stop prompt told the model to cite "file or host observation" references,
// which excluded the source this stage added. A correction that cannot be cited
// is a correction that never reaches a proposal.
test('the capture prompt tells the model a correction is citable', async () => {
  const { STOP_CAPTURE_PROMPT } = await import('../../src/hooks/capture.js');
  assert.match(STOP_CAPTURE_PROMPT, /user correction/i);
  assert.match(STOP_CAPTURE_PROMPT, /never invent user approval/);
});

test('the plain (non-codex) host never sees the legacy top-level allow decision on PreToolUse', async () => {
  const root = await project();
  const result = await hook(root, 'pre-tool', { tool_name: 'Read', tool_input: { file_path: 'x.js' } });
  assert.equal(result.decision, undefined);
});
