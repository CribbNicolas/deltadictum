import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genericReasons } from '../../src/capture/generic.js';

const m = (body, title = 'A rule') => ({ title, body, triggers: [{ on: ['edit'], paths: ['src/a.js'] }] });

test('advice that names nothing of the repository is generic, even with specific triggers', () => {
  for (const body of ['Write tests before changing code.', 'Be careful with error handling and keep functions small.']) {
    assert.deepEqual(genericReasons(m(body)), ['generic_advice'], body);
  }
});

test('a path, a symbol, a command, a flag or a value makes it specific', () => {
  for (const body of ['Close the store in `t.after`.', 'Run src/cli.js compile first.', 'Call createMemoryStore once per test.',
    'Use --test-concurrency=1 on Windows.', 'Hooks time out after 10 s.', 'Set DD_RESIDENT_REGISTRY to a temp file.', 'Keep tests/helpers/isolate-data.js imported.']) {
    assert.deepEqual(genericReasons(m(body)), [], body);
  }
});
