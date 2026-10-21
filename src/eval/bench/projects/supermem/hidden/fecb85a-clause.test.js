import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as clause from '../../../src/engine/clause.cjs';
import { compileIndex } from '../../../src/engine/compile.js';
import { matchEvent, prepareIndex } from '../../../src/engine/match.cjs';

// Benchmark edit: a namespace import, so a fix that renames globToRegExp fails only the tests that use it.
const { clauseMatches, globToRegExp, hasCommand, hasSymbol, memoryMatch } = clause;

const ev = (kind, paths = [], text = '') => ({ kind, paths, text });

const memory = (id, triggers) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title: `Memory ${id}`,
  body: `Body of ${id}.`, not_derivable: 'Hidden.', origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
  triggers, evidence: [{ type: 'note', ref: 'x', summary: 'n' }],
});

// Chained `**/` once compiled to nested optional groups that backtrack
// exponentially on a path they miss: 16 of them hung every hook for minutes.
// Benchmark edit: judged through what every design keeps, the reference matcher
// and the compiled index the hook matches against, not through globToRegExp.
test('chained ** segments match as one and stay fast on a path they miss', () => {
  const chained = `${'**/'.repeat(16)}*.test.js`;
  const { index } = compileIndex({ memories: [memory('m1', [{ on: ['read'], paths: [chained] }]),
    memory('m2', [{ on: ['read'], paths: ['src/**/**'] }])], manifest: { count: 2, hash: 'h' } });
  const runtime = prepareIndex(index);
  const fired = path => matchEvent(runtime, ev('read', [path])).map(hit => hit.id);
  const reference = (glob, path) => clauseMatches({ on: ['read'], paths: [glob] }, ev('read', [path])).matched;
  assert.deepEqual(fired('a/b/x.test.js'), ['m1']);
  assert.deepEqual(fired('x.test.js'), ['m1']);
  assert.equal(reference(chained, 'a/b/x.test.js'), true);
  assert.equal(reference(chained, 'x.test.js'), true);
  const deep = `${Array.from({ length: 22 }, (_, i) => `d${i}`).join('/')}/x.txt`;
  const started = performance.now();
  assert.deepEqual(fired(deep), []);
  assert.equal(reference(chained, deep), false);
  assert.equal(reference('src/**/**', deep), false);
  assert.ok(performance.now() - started < 50, `took ${performance.now() - started} ms`);
});

test('globs cross folders with ** and stay in one segment with * and ?', () => {
  const tests = globToRegExp('tests/**/*.test.js');
  assert.ok(tests.test('tests/a.test.js'));
  assert.ok(tests.test('tests/mcp/deep/tools.test.js'));
  assert.ok(!tests.test('src/tests/a.test.js'));
  assert.ok(globToRegExp('src/*.js').test('src/cli.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/store/paths.js'));
  assert.ok(globToRegExp('src/**').test('src/store/paths.js'));
  assert.ok(globToRegExp('file?.md').test('file1.md'));
  assert.ok(!globToRegExp('package.json').test('xpackage.json'));
});

test('a path clause matches the event kinds it lists and the files it names', () => {
  const clause = { on: ['read', 'edit'], paths: ['src/store/paths.js'] };
  assert.deepEqual(clauseMatches(clause, ev('read', ['src/store/paths.js'])), { matched: true, via: ['paths'] });
  assert.equal(clauseMatches(clause, ev('write', ['src/store/paths.js'])).matched, false);
  assert.equal(clauseMatches(clause, ev('read', ['src/store/adopt.js'])).matched, false);
});

test('symbols match whole identifiers in what the agent writes, runs or searches, case-sensitive', () => {
  assert.ok(hasSymbol('const s = await createMemoryStore(dir);', 'createMemoryStore'));
  assert.ok(!hasSymbol('recreateMemoryStore(dir)', 'createMemoryStore'));
  assert.ok(!hasSymbol('creatememorystore(dir)', 'createMemoryStore'));
  assert.ok(hasSymbol('await store.reindex();', 'store.reindex'));
  const clause = { on: ['edit'], paths: ['tests/**/*.test.js'], symbols: ['createMemoryStore'] };
  assert.equal(clauseMatches(clause, ev('edit', ['tests/mcp/tools.test.js'], 'await createMemoryStore(d)')).matched, true);
  assert.equal(clauseMatches(clause, ev('edit', ['tests/mcp/tools.test.js'], 'assert.ok(x)')).matched, false);
});

test('commands match a token sequence, on run events only', () => {
  assert.ok(hasCommand('node  --test   tests/a.test.js', 'node --test'));
  assert.ok(!hasCommand('node --testing x', 'node --test'));
  const clause = { on: ['run', 'search'], commands: ['npm publish'] };
  assert.equal(clauseMatches(clause, ev('run', [], 'npm publish --dry-run')).matched, true);
  assert.equal(clauseMatches(clause, ev('search', [], 'npm publish')).matched, false);
});

test('keywords match whole phrases on prompt and search events, ignoring case, accents and simple plurals', () => {
  const clause = { on: ['prompt', 'search', 'edit'], keywords: ['data directory', 'directorio de datos', 'sqlite store'] };
  assert.equal(clauseMatches(clause, ev('prompt', [], 'Rename the DD data directory')).matched, true);
  assert.equal(clauseMatches(clause, ev('prompt', [], 'Cambiá el directorio de datos')).matched, true);
  assert.equal(clauseMatches(clause, ev('search', [], 'close the SQLite stores')).matched, true);
  assert.equal(clauseMatches(clause, ev('edit', ['x.js'], 'data directory')).matched, false);
  assert.equal(clauseMatches(clause, ev('prompt', [], 'the data of the directory')).matched, false);
});

test('symbols are never matched against a prompt: the signal is what the agent does', () => {
  const clause = { on: ['prompt', 'edit'], symbols: ['loadConfig'] };
  assert.equal(clauseMatches(clause, ev('prompt', [], 'why does loadConfig run twice?')).matched, false);
  assert.equal(clauseMatches(clause, ev('edit', ['src/a.js'], 'loadConfig()')).matched, true);
});

test('not cancels by phrase and not_paths by glob, whatever characters a phrase holds', () => {
  const phrase = { on: ['prompt'], keywords: ['threshold'], not: ['and/or'] };
  assert.equal(clauseMatches(phrase, ev('prompt', [], 'the threshold and/or the limit')).matched, false);
  const file = { on: ['read'], paths: ['src/**'], not: ['package.json'] };
  assert.equal(clauseMatches(file, ev('read', ['src/package.json'])).matched, true);
});

test('every stated dimension must match, and not or not_paths cancel the clause', () => {
  const clause = { on: ['edit'], paths: ['src/**'], symbols: ['loadConfig'], not_paths: ['src/ui/**'] };
  assert.equal(clauseMatches(clause, ev('edit', ['src/store/a.js'], 'loadConfig()')).matched, true);
  assert.equal(clauseMatches(clause, ev('edit', ['src/store/a.js'], 'other()')).matched, false);
  assert.equal(clauseMatches(clause, ev('edit', ['src/ui/server.js'], 'loadConfig()')).matched, false);
  const phrase = { on: ['prompt'], keywords: ['threshold'], not: ['token threshold'] };
  assert.equal(clauseMatches(phrase, ev('prompt', [], 'raise the token threshold')).matched, false);
  assert.equal(clauseMatches(phrase, ev('prompt', [], 'raise the threshold')).matched, true);
});

test('a clause with nothing but on never matches', () => {
  assert.equal(clauseMatches({ on: ['edit'] }, ev('edit', ['a.js'], 'x')).matched, false);
  assert.equal(clauseMatches({ on: ['edit'], paths: [] }, ev('edit', ['a.js'], 'x')).matched, false);
  assert.equal(clauseMatches({ paths: ['a.js'] }, ev('edit', ['a.js'], 'x')).matched, false);
});

test('a memory fires on its best clause: the one matching most dimensions', () => {
  const memory = { triggers: [{ on: ['edit'], paths: ['src/a.js'] }, { on: ['edit'], paths: ['src/a.js'], symbols: ['run'] }] };
  assert.deepEqual(memoryMatch(memory, ev('edit', ['src/a.js'], 'run()')).via, ['paths', 'symbols']);
  assert.deepEqual(memoryMatch(memory, ev('edit', ['src/a.js'], 'x')).via, ['paths']);
  assert.equal(memoryMatch(memory, ev('read', ['src/a.js'])), null);
});
