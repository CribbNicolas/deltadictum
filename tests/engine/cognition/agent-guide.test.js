import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineeringGuide, guideSection } from '../../../src/eval/agent/guide.js';

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
