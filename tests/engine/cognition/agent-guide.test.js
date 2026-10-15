import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineeringGuide, engineeringGuideV2, guideSection, guideSectionV2 } from '../../../src/eval/agent/guide.js';

// A v2 memory, as the trial store holds it (src/eval/agent/trial-memories.js).
const v2 = (over = {}) => ({
  schema_version: 8, id: '0a1b2c3d-0000-4000-8000-000000000000', topic: 'testing/sqlite-handle-before-rm', kind: 'trap', status: 'active',
  title: 'Close every node:sqlite handle before removing its folder', body: 'On Windows, rmSync of a folder with an open handle fails with EPERM.',
  not_derivable: 'Linux removes the folder with the handle open.',
  triggers: [{ on: ['read'], paths: ['tests/maintenance/*.test.js'] }, { on: ['edit', 'write'], paths: ['tests/maintenance/**'], symbols: ['openTelemetry'] },
    { on: ['run'], commands: ['node -e'] }, { on: ['prompt', 'search'], keywords: ['telemetry test'], not: ['no telemetry'] }],
  evidence: [{ type: 'file', path: 'tests/maintenance/telemetry.test.js', sha256: 'a'.repeat(64), summary: 'Closes the handle in t.after.' }],
  ...over,
});

test('a v2 guide section carries the body, when it applies, why the code does not show it and the references, nothing DD-internal', () => {
  const text = guideSectionV2(v2());
  assert.match(text, /^### Close every node:sqlite handle before removing its folder$/m);
  assert.match(text, /\*Trap\.\* \*\*Applies when:\*\* reading `tests\/maintenance\/\*\.test\.js`; editing or writing `tests\/maintenance\/\*\*` with `openTelemetry`; running `node -e`; a prompt or a search mentioning "telemetry test", unless "no telemetry"\./);
  assert.match(text, /^On Windows, rmSync of a folder with an open handle fails with EPERM\.$/m);
  assert.match(text, /\*\*Why the code does not show it:\*\* Linux removes the folder with the handle open\./);
  assert.match(text, /- `tests\/maintenance\/telemetry\.test\.js`: Closes the handle in t\.after\./);
  assert.doesNotMatch(text, /aaaaaaaa|sqlite-handle-before-rm|0a1b2c3d|schema_version|not_derivable/);
});

test('the v2 guide groups live memories by the first segment of their topic and skips the rest', () => {
  const guide = engineeringGuideV2([v2(), v2({ id: 'b', topic: 'engine/compiled-index-version', title: 'Bump INDEX_VERSION', kind: 'procedure' }),
    v2({ id: 'c', topic: 'engine/old', title: 'Retired rule', status: 'archived' })]);
  assert.match(guide, /^# Engineering guide$/m);
  assert.deepEqual([...guide.matchAll(/^## (.+)$/gm)].map(m => m[1]), ['Engine', 'Testing']);
  assert.match(guide, /\*Procedure\.\*/);
  assert.doesNotMatch(guide, /Retired rule/);
});

const atom = (over = {}) => ({
  id: '19a1686f-66d6-4d5f-88f9-cfe3b46d6f1b', topic_key: 'dd/engine/auto-accept-threshold-reachable-ceilings', memory_type: 'lesson',
  lifecycle_state: 'active', title: 'Auto-accept threshold must be a reachable ceiling',
  trigger: 'Setting or reviewing auto_accept.confidence_threshold', behavior_delta: 'Use only a reachable ceiling as the threshold.',
  why: 'A value between two ceilings behaves like the next one up.',
  applies_to: { files: ['src/store/paths.js', 'src/engine/reliability.js'], components: ['auto-accept'], operations: [] },
  assumptions: ['Ceilings come from RELIABILITY_CAP'], alternatives: [], anchors: { keywords: ['threshold'] },
  revisit_when: [{ kind: 'file_changed', description: 'reliability caps change', path: 'src/engine/reliability.js', hash: 'abc' }],
  evidence_refs: [{ source_type: 'file', source_ref: 'src/store/paths.js', summary: 'Default moved from 0.8 to 0.85' }],
  ...over,
});

test('a guide section carries every authored field of the memory as documentation', () => {
  const text = guideSection(atom());
  assert.match(text, /^### Auto-accept threshold must be a reachable ceiling$/m);
  assert.match(text, /Applies when:\*\* Setting or reviewing auto_accept\.confidence_threshold/);
  assert.match(text, /Use only a reachable ceiling as the threshold\./);
  assert.match(text, /\*\*Why:\*\* A value between two ceilings/);
  assert.match(text, /`src\/store\/paths\.js`, `src\/engine\/reliability\.js`/);
  assert.match(text, /auto-accept/);
  assert.match(text, /Ceilings come from RELIABILITY_CAP/);
  assert.match(text, /reliability caps change/);
  assert.match(text, /- `src\/store\/paths\.js`: Default moved from 0\.8 to 0\.85/);
});

test('a guide section leaves out what only DD uses: ids, topic keys, anchors and hashes', () => {
  const text = guideSection(atom());
  assert.doesNotMatch(text, /19a1686f|dd\/engine\/auto-accept|keywords|abc\b|file_changed/);
});

test('the guide groups active memories by area and skips the rest', () => {
  const guide = engineeringGuide([
    atom(),
    atom({ id: 'b', topic_key: 'testing/quote-test-globs', title: 'Quote test globs', memory_type: 'decision' }),
    atom({ id: 'c', topic_key: 'memory/retrieval/compact-fts', title: 'Compact retrieval' }),
    atom({ id: 'd', topic_key: 'testing/old', title: 'Retired advice', lifecycle_state: 'legacy' }),
  ]);
  assert.match(guide, /^# Engineering guide$/m);
  const areas = [...guide.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(areas, ['Engine', 'Retrieval', 'Testing']);
  assert.match(guide, /### Quote test globs/);
  assert.doesNotMatch(guide, /Retired advice/);
  assert.equal(guide.match(/^### /gm).length, 3);
});
