import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineeringGuide, guideSection } from '../../../src/eval/agent/guide.js';

// A memory, as the trial store holds it (src/eval/agent/trial-memories.js).
const memory = (over = {}) => ({
  schema_version: 8, id: '0a1b2c3d-0000-4000-8000-000000000000', topic: 'testing/sqlite-handle-before-rm', kind: 'trap', status: 'active',
  title: 'Close every node:sqlite handle before removing its folder', body: 'On Windows, rmSync of a folder with an open handle fails with EPERM.',
  not_derivable: 'Linux removes the folder with the handle open.',
  triggers: [{ on: ['read'], paths: ['tests/maintenance/*.test.js'] }, { on: ['edit', 'write'], paths: ['tests/maintenance/**'], symbols: ['openTelemetry'] },
    { on: ['run'], commands: ['node -e'] }, { on: ['prompt', 'search'], keywords: ['telemetry test'], not: ['no telemetry'] }],
  evidence: [{ type: 'file', path: 'tests/maintenance/telemetry.test.js', sha256: 'a'.repeat(64), summary: 'Closes the handle in t.after.' }],
  ...over,
});

test('a guide section carries the body, when it applies, why the code does not show it and the references, nothing DD-internal', () => {
  const text = guideSection(memory());
  assert.match(text, /^### Close every node:sqlite handle before removing its folder$/m);
  assert.match(text, /\*Trap\.\* \*\*Applies when:\*\* reading `tests\/maintenance\/\*\.test\.js`; editing or writing `tests\/maintenance\/\*\*` with `openTelemetry`; running `node -e`; a prompt or a search mentioning "telemetry test", unless "no telemetry"\./);
  assert.match(text, /^On Windows, rmSync of a folder with an open handle fails with EPERM\.$/m);
  assert.match(text, /\*\*Why the code does not show it:\*\* Linux removes the folder with the handle open\./);
  assert.match(text, /- `tests\/maintenance\/telemetry\.test\.js`: Closes the handle in t\.after\./);
  assert.doesNotMatch(text, /aaaaaaaa|sqlite-handle-before-rm|0a1b2c3d|schema_version|not_derivable/);
});

test('the guide groups live memories by the first segment of their topic and skips the rest', () => {
  const guide = engineeringGuide([memory(), memory({ id: 'b', topic: 'engine/compiled-index-version', title: 'Bump INDEX_VERSION', kind: 'procedure' }),
    memory({ id: 'c', topic: 'engine/old', title: 'Retired rule', status: 'archived' })]);
  assert.match(guide, /^# Engineering guide$/m);
  assert.deepEqual([...guide.matchAll(/^## (.+)$/gm)].map(m => m[1]), ['Engine', 'Testing']);
  assert.match(guide, /\*Procedure\.\*/);
  assert.doesNotMatch(guide, /Retired rule/);
});
