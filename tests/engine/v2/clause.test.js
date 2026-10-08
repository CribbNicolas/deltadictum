import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clauseMatches, globToRegExp, hasCommand, hasSymbol, memoryMatch } from '../../../src/engine/clause.js';

const ev = (kind, paths = [], text = '') => ({ kind, paths, text });

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

test('every stated dimension must match, and not cancels the clause', () => {
  const clause = { on: ['edit'], paths: ['src/**'], symbols: ['loadConfig'], not: ['src/ui/**'] };
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
