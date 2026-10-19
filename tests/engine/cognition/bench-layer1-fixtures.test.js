import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { FIXTURES } from '../../../src/eval/bench/layer1/extract.js';
import { loadLayer1, memoriesFor, replayProject } from '../../../src/eval/bench/layer1/run.js';

const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter(name => name.endsWith('.json.gz')).sort() : [];

test('every committed layer 1 fixture replays to its recorded summary, on both engines', async () => {
  assert.ok(files.length >= 3, `committed fixtures: ${files.join(', ') || 'none'}`);
  for (const file of files) {
    const fixture = await loadLayer1(join(FIXTURES, file));
    const out = replayProject(fixture, await memoriesFor(fixture.project));
    assert.ok(out.production_equals_reference, `${file}: the production engine delivers what the reference does`);
    const expected = JSON.parse(readFileSync(join(FIXTURES, file.replace(/\.json\.gz$/, '.expected.json')), 'utf8'));
    assert.deepEqual(out.summary, expected, `${file}: replay reproduces ${file.replace(/\.json\.gz$/, '.expected.json')}`);
  }
});

test('no committed fixture names an absolute path or a user', () => {
  for (const file of files) {
    const bytes = readFileSync(join(FIXTURES, file));
    assert.ok(statSync(join(FIXTURES, file)).size < 1024 * 1024, `${file} is under 1 MB`);
    const text = gunzipSync(bytes).toString('utf8');
    for (const run of JSON.parse(text).runs) {
      for (const path of run.events.flatMap(event => event.paths)) assert.doesNotMatch(path, /^[A-Za-z]:[\\/]|^\/|^~/, `${file} ${run.run_id}: ${path}`);
    }
    // A drive letter and a folder between escaped backslashes is a Windows path in JSON text
    // (`%d:\n` in a format string, or `f:\\n` in code, is not).
    assert.doesNotMatch(text, /Users[\\/]|\/home\/|dd-bench-|(?<![A-Za-z%])[A-Za-z]:\\\\[\w.-]+\\\\/, file);
  }
  assert.ok(!files.some(file => file.startsWith('patriark')), 'Patriark\'s fixture is never committed');
});
