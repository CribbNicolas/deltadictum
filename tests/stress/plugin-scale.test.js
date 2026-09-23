import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createToolHandlers } from '../../src/mcp/tools.js';
import { buildSessionStartContext } from '../../src/hooks/session-start.js';
import { estimateTokens as payloadEstimate } from '../../src/engine/budget.js';
import { DEFAULT_CONFIG } from '../../src/store/paths.js';

// No resident here: these tests measure retrieval in the explicit lexical mode.
process.env.DD_RETRIEVAL = 'lexical';

const CORPUS =Math.max(200, Number(process.env.DD_STRESS_ATOMS ?? 2000));
const ROUNDS = Math.max(10, Number(process.env.DD_STRESS_ROUNDS ?? 40));
const CONCURRENCY = Math.max(4, Number(process.env.DD_STRESS_CONCURRENCY ?? 16));

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function parseTool(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

function fillerAtom(i, projectId, updatedAt) {
  return {
    id: `load-${projectId}-${i}`,
    project_id: projectId,
    memory_type: 'lesson',
    scope: 'project',
    title: `Synthetic ${i}`,
    trigger: `when running unit tests in module ${i}`,
    behavior_delta: `isolate fixture ${i}`,
    what: `Synthetic fixture ${i}.`,
    why: `Load-test isolation ${i}.`,
    authority: 'inferred',
    confidence: 0.7,
    valid_from: '2026-09-09T00:00:00.000Z',
    topic_key: `synth/${projectId}/item-${i}`,
    tags: ['synth'],
    lifecycle_state: 'active',
    retrieval_forms: { micro: `Synth ${i}.`, short: `Run tests in module ${i}.` },
    created_at: '2026-09-09T00:00:00.000Z',
    updated_at: updatedAt,
  };
}

function needleAtom(projectId) {
  return {
    id: `needle-${projectId}`,
    project_id: projectId,
    memory_type: 'lesson',
    scope: 'project',
    title: 'Require trigger',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first',
    what: 'Durable memory needs a trigger.',
    why: 'Stops V1 dumps.',
    authority: 'inferred',
    confidence: 0.8,
    valid_from: '2026-09-09T00:00:00.000Z',
    topic_key: `memory/${projectId}/required-fields`,
    tags: ['memory'],
    lifecycle_state: 'active',
    retrieval_forms: {
      micro: 'Require trigger.',
      short: 'Validate trigger before active memory.',
    },
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'Admission gate' }],
  };
}

describe(`plugin stress (${CORPUS} atoms)`, { timeout: 120000 }, () => {
  let store;
  let tools;
  let gitPath;
  let gitBefore;

  before(async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-stress-'));
    store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom(needleAtom('demo'));
    gitPath = join(root, '.dd', 'atoms', 'memory', 'demo', 'required-fields.json');
    gitBefore = await readFile(gitPath, 'utf8');
    for (let i = 0; i < CORPUS; i += 1) {
      store.index.upsertAtom(fillerAtom(i, 'demo', '2099-01-01T00:00:00.000Z'));
    }
    for (let i = 0; i < 200; i += 1) {
      store.index.upsertAtom(fillerAtom(i, 'other', '2099-01-01T00:00:00.000Z'));
    }
    tools = createToolHandlers({ store, projectId: 'demo', uiPort: 7733 });
  });

  after(() => {
    store.close();
  });

  test('MCP retrieve finds the buried needle, stays compact, and finishes well under a second', async () => {
    const started = Date.now();
    const retrieved = parseTool(await tools.retrieve({ action: 'before writing durable memory' }));
    const elapsed = Date.now() - started;

    assert.equal(retrieved.abstained, false);
    assert.ok(retrieved.memories.some(hit => hit.id === 'needle-demo'));
    assert.ok(retrieved.memories.length <= 8);
    assert.ok(retrieved.memories.every(hit => hit.evidence_refs === undefined));
    assert.ok(retrieved.memories.every(hit => hit.what === undefined && hit.retrieval_forms === undefined));
    assert.ok(elapsed < 1000, `retrieve took ${elapsed}ms`);

    const payload = JSON.stringify(retrieved);
    const payloadTokens = estimateTokens(payload);
    const contentTokens = retrieved.memories.reduce((sum, hit) => sum + estimateTokens(hit.content), 0);
    assert.ok(payloadTokens < contentTokens * 12 + 120, `payload ${payloadTokens} tokens vs content ${contentTokens}`);
    // The model-facing view is a subset of the payload the engine budgeted.
    assert.ok(payloadEstimate(retrieved) <= DEFAULT_CONFIG.budget_tokens);

    console.log(`[stress] retrieve_ms=${elapsed} hits=${retrieved.memories.length} payload_tokens=${payloadTokens} content_tokens=${contentTokens}`);
  });

  test('repeated MCP retrieve stays in the same latency class', async () => {
    const samples = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const started = Date.now();
      const retrieved = parseTool(await tools.retrieve({ action: 'before writing durable memory' }));
      samples.push(Date.now() - started);
      assert.equal(retrieved.abstained, false);
      assert.ok(retrieved.memories.length <= 8);
    }
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);
    assert.ok(p95 < 500, `p95 ${p95}ms`);
    assert.ok(p99 < 1000, `p99 ${p99}ms`);
    console.log(`[stress] rounds=${ROUNDS} p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
  });

  test('concurrent MCP retrieve does not explode or leak full atoms', async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => tools.retrieve({ action: 'before writing durable memory' })),
    );
    const wall = Date.now() - started;
    for (const raw of results) {
      const retrieved = parseTool(raw);
      assert.equal(retrieved.abstained, false);
      assert.ok(retrieved.memories.length <= 8);
      assert.ok(retrieved.memories.every(hit => hit.evidence_refs === undefined));
    }
    assert.ok(wall < 3000, `concurrent wall ${wall}ms`);
    console.log(`[stress] concurrency=${CONCURRENCY} wall_ms=${wall}`);
  });

  test('unrelated actions still abstain against a bloated store', async () => {
    const retrieved = parseTool(await tools.retrieve({ action: 'unrelated cooking recipe' }));
    assert.equal(retrieved.abstained, true);
    assert.equal(retrieved.memories.length, 0);
    assert.ok(payloadEstimate(retrieved) <= DEFAULT_CONFIG.budget_tokens);
  });

  test('shared stopwords cannot flood the injection cap', async () => {
    for (let i = 0; i < 30; i += 1) {
      store.index.upsertAtom({
        ...fillerAtom(i, 'demo', '2099-06-01T00:00:00.000Z'),
        id: `overlap-${i}`,
        topic_key: `synth/overlap/item-${i}`,
        trigger: `before writing ${i % 2 === 0 ? 'tests' : 'docs'}`,
        title: `Before writing overlap ${i}`,
        retrieval_forms: { micro: `Overlap ${i}.`, short: `Before writing overlap ${i}.` },
      });
    }
    const retrieved = parseTool(await tools.retrieve({ action: 'before writing tests' }));
    assert.ok(retrieved.memories.length <= 8);
    assert.ok(retrieved.memories.every(hit => hit.evidence_refs === undefined));
  });

  test('status and SessionStart stay cheap at corpus scale', async () => {
    const statusStarted = Date.now();
    const status = parseTool(await tools.status());
    const statusMs = Date.now() - statusStarted;
    assert.ok(status.total >= CORPUS + 1);
    assert.ok(status.counts.active >= CORPUS + 1);
    assert.ok(statusMs < 100, `status took ${statusMs}ms`);

    const sessionStarted = Date.now();
    const session = await buildSessionStartContext({
      store,
      projectId: 'demo',
      uiUrl: 'http://127.0.0.1:7733',
    });
    const sessionMs = Date.now() - sessionStarted;
    assert.match(session.hookSpecificOutput.additionalContext, /DD - loaded for `demo`/);
    assert.ok(sessionMs < 1000, `session-start took ${sessionMs}ms`);
    console.log(`[stress] status_ms=${statusMs} session_start_ms=${sessionMs} total=${status.total}`);
  });

  test('retrieve does not dirty git atoms under load', async () => {
    await tools.retrieve({ action: 'before writing durable memory' });
    const after = await readFile(gitPath, 'utf8');
    assert.equal(after, gitBefore);
  });

  test('another project cannot see this corpus', async () => {
    const otherTools = createToolHandlers({ store, projectId: 'other', uiPort: 7733 });
    const retrieved = parseTool(await otherTools.retrieve({ action: 'before writing durable memory' }));
    assert.equal(retrieved.memories.length, 0);
    const status = parseTool(await otherTools.status());
    assert.equal(status.counts.active, 200);
  });

  test('the collision routing keeps the write path bounded at corpus scale', async () => {
    // The comparison runs against every effective memory, so its cost grows with
    // the store. This is the scale that has to stay affordable, not a microbenchmark.
    const started = Date.now();
    const result = parseTool(await tools.propose({ proposals: [{
      memory_type: 'lesson', scope: 'project',
      title: 'Collision cost at scale',
      trigger: 'before writing durable memory to a large store',
      behavior_delta: 'compare the trigger against effective memories before writing',
      what: 'The collision check precedes the write.',
      why: 'A decision cannot be routed on a value the write produces.',
      topic_key: 'memory/demo/collision-cost',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/write.js', summary: 'Write path' }],
      retrieval_forms: { micro: 'Check collisions first.', short: 'Route the write on the collision result.' },
    }] }));
    const elapsed = Date.now() - started;

    const [proposed] = result.proposals;
    assert.ok(['write', 'update'].includes(proposed.decision), `decision was ${proposed.decision}`);
    assert.ok(elapsed < 2000, `propose took ${elapsed}ms against ${CORPUS} atoms`);
    console.log(`[stress] propose_ms=${elapsed} atoms=${CORPUS} decision=${proposed.decision}`);
  });
});
