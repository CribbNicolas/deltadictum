import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileIndex, compileProject, INDEX_VERSION, writeCompiled } from '../../../src/engine/compile.js';
import { loadIndex, readBodies } from '../../../src/engine/index-file.cjs';
import { localPaths } from '../../../src/engine/locate.cjs';
import { createMemoryFiles } from '../../../src/memory/store.js';

const memory = (id, over = {}) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title: `Memory ${id}`,
  body: `Body of ${id}.`, not_derivable: 'Hidden.', origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
  triggers: [{ on: ['read', 'edit'], paths: ['src/a.js'] }],
  evidence: [{ type: 'file', path: 'src/a.js', sha256: 'a'.repeat(64), summary: 's' }, { type: 'note', ref: 'x', summary: 'n' }],
  ...over,
});

test('only live memories compile, clauses keep their order and come precompiled', () => {
  const { index, bodies } = compileIndex({
    memories: [
      memory('m1', { triggers: [
        { on: ['edit'], paths: ['tests/**/*.test.js'], symbols: ['createMemoryStore'], not_paths: ['tests/x/**'] },
        { on: ['run'], commands: ['node  --test'] },
        { on: ['prompt'], keywords: ['Data Directory'], not: ['token threshold'] },
      ] }),
      memory('m2', { status: 'contested' }),
      memory('m3', { status: 'candidate' }),
    ],
    manifest: { version: 1, count: 3, hash: 'h' }, fingerprint: 'f',
  });
  assert.equal(index.version, INDEX_VERSION);
  assert.deepEqual(index.manifest, { count: 3, hash: 'h' });
  assert.equal(index.fingerprint, 'f');
  assert.deepEqual(Object.keys(index.memories), ['m1', 'm2']);
  assert.deepEqual(index.memories.m2, { title: 'Memory m2', kind: 'trap', status: 'contested' });
  assert.deepEqual(index.clauses.map(c => [c.m, c.dims]), [['m1', ['paths', 'symbols']], ['m1', ['commands']], ['m1', ['keywords']], ['m2', ['paths']]]);
  assert.equal(new RegExp(index.clauses[0].paths[0]).test('tests/mcp/tools.test.js'), true);
  assert.equal(new RegExp(index.clauses[0].not_paths[0]).test('tests/x/y.test.js'), true);
  assert.deepEqual(index.clauses[1].commands, [['node', '--test']]);
  assert.deepEqual(index.clauses[2].keywords, [['data', 'directory']]);
  assert.deepEqual(index.clauses[2].not, [['token', 'threshold']]);
  assert.deepEqual(bodies.m1, { body: 'Body of m1.', evidence: [{ path: 'src/a.js', sha256: 'a'.repeat(64) }] });
  assert.equal(bodies.m3, undefined);
});

// The hot path reads these keys. Changing them needs a new INDEX_VERSION, so an
// index of the old shape is ignored and recompiled instead of misread.
test('the compiled index has the shape its INDEX_VERSION names', () => {
  const { index } = compileIndex({ memories: [memory('m1', { triggers: [
    { on: ['edit'], paths: ['src/a.js'], symbols: ['s'], commands: ['npm test'], keywords: ['k'], not: ['n'], not_paths: ['x/**'] },
  ] })], manifest: { count: 1, hash: 'h' }, fingerprint: 'f', bodiesFile: 'bodies-x.json' });
  assert.equal(INDEX_VERSION, 3);
  assert.deepEqual(Object.keys(index).sort(), ['bodies', 'clauses', 'fingerprint', 'manifest', 'memories', 'version']);
  assert.equal(index.bodies, 'bodies-x.json');
  assert.deepEqual(Object.keys(index.memories.m1).sort(), ['kind', 'status', 'title']);
  assert.deepEqual(Object.keys(index.clauses[0]).sort(), ['commands', 'dims', 'keywords', 'm', 'not', 'not_paths', 'on', 'paths', 'symbols']);
});

// A hook that read the previous index while a compile ran must still find that
// index's bodies; a body never comes from another build.
test('each build writes its own bodies file, and a reader of the previous index still finds its bodies', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createMemoryFiles(join(root, '.dd'));
  await store.commit({ put: [memory('m1', { body: 'First body.' })] });
  await compileProject(root);
  const first = loadIndex(root);
  await store.commit({ put: [memory('m1', { body: 'Second body.' })] });
  await compileProject(root);
  const second = loadIndex(root);
  assert.notEqual(first.bodies, second.bodies);
  assert.equal(readBodies(root, first).m1.body, 'First body.');
  assert.equal(readBodies(root, second).m1.body, 'Second body.');
  // A minute later, only the current build and the one before it are kept.
  const third = compileIndex({ memories: await store.list(), manifest: await store.manifest(), fingerprint: 'f' });
  writeCompiled(localPaths(root), third, { now: Date.now() + 2 * 60 * 1000 });
  const kept = readdirSync(join(root, '.dd', 'local', 'v2')).filter(name => name.startsWith('bodies')).sort();
  assert.deepEqual(kept, [second.bodies, loadIndex(root).bodies].sort());
});

// Two session starts compiling at once: the one that finishes last must not
// delete the bodies the final index names.
test('a compile that overlaps another never leaves the index without its bodies', t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = localPaths(root);
  const build = name => compileIndex({ memories: [memory('m1', { body: `Body ${name}.` })], manifest: { count: 1, hash: name }, fingerprint: name });
  writeCompiled(paths, build('p'));
  // X renames its index, then Y runs from start to end, then X cleans up.
  const interleaved = (from, to) => {
    renameSync(from, to);
    if (to === paths.index) writeCompiled(paths, build('y'));
  };
  writeCompiled(paths, build('x'), { rename: interleaved });
  const index = loadIndex(root);
  assert.equal(index.manifest.hash, 'y');
  assert.equal(readBodies(root, index).m1.body, 'Body y.');
});

// Windows refuses a rename over a file another process holds open for a moment.
test('a rename the system refuses for a moment is retried, and a lasting refusal leaves no temp file', t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = localPaths(root);
  const compiled = compileIndex({ memories: [memory('m1')], manifest: { count: 1, hash: 'h' }, fingerprint: 'f', bodiesFile: 'bodies-a.json' });
  let refusals = 2;
  const flaky = (from, to) => {
    if (refusals > 0) { refusals -= 1; throw Object.assign(new Error('busy'), { code: 'EPERM' }); }
    renameSync(from, to);
  };
  writeCompiled(paths, compiled, { rename: flaky });
  assert.equal(loadIndex(root).bodies, 'bodies-a.json');
  const refuse = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
  assert.throws(() => writeCompiled(paths, { ...compiled, index: { ...compiled.index, bodies: 'bodies-b.json' } }, { rename: refuse }), /busy/);
  assert.deepEqual(readdirSync(paths.v2).filter(name => name.endsWith('.tmp')), []);
  assert.equal(loadIndex(root).bodies, 'bodies-a.json');
});

test('dead and broad triggers are reported, never dropped', () => {
  const repoFiles = [...Array.from({ length: 40 }, (_, i) => `src/f${i}.js`), 'tests/a.test.js'];
  const { index, warnings } = compileIndex({
    memories: [memory('m1', { triggers: [
      { on: ['read'], paths: ['src/**', 'docs/gone.md'] },
      { on: ['edit'], paths: ['src/f1.js'], symbols: ['realThing', 'ghostThing'] },
    ] })],
    manifest: { count: 1, hash: 'h' }, fingerprint: 'f', repoFiles, symbolExists: symbol => symbol === 'realThing',
  });
  assert.equal(index.clauses.length, 2);
  assert.deepEqual(warnings, [
    { memory: 'm1', kind: 'broad_glob', value: 'src/**', files: 40 },
    { memory: 'm1', kind: 'dead_glob', value: 'docs/gone.md' },
    { memory: 'm1', kind: 'dead_symbol', value: 'ghostThing' },
  ]);
});

test('compiling a project writes the index, the bodies and the git-ignore for derived files', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createMemoryFiles(join(root, '.dd'));
  await store.commit({ put: [memory('m1')] });
  const result = await compileProject(root);
  assert.deepEqual({ memories: result.memories, clauses: result.clauses }, { memories: 1, clauses: 1 });
  const index = JSON.parse(readFileSync(join(root, '.dd', 'local', 'v2', 'index.json'), 'utf8'));
  assert.equal(index.manifest.count, 1);
  assert.ok(existsSync(join(root, '.dd', 'local', 'v2', index.bodies)));
  assert.match(readFileSync(join(root, '.dd', '.gitignore'), 'utf8'), /^local\/$/m);
  await compileProject(root);
  assert.equal(readFileSync(join(root, '.dd', '.gitignore'), 'utf8').match(/^local\/$/gm).length, 1);
});

// A memory file names its own symbols; only the project's code says whether they exist.
test('a symbol found only in DD files is dead; one in the code is not, however many there are', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, 'src'));
  const present = Array.from({ length: 60 }, (_, i) => `liveSymbol${i}`);
  writeFileSync(join(root, 'src', 'a.js'), present.map(name => `export function ${name}() {}`).join('\n'));
  // At most 12 symbols a clause: six memories of ten, the last with a symbol no code has.
  const groups = Array.from({ length: 6 }, (_, i) => present.slice(i * 10, i * 10 + 10));
  groups[5].push('ghostSymbol');
  await createMemoryFiles(join(root, '.dd')).commit({ put: groups.map((symbols, i) => memory(`m${i}`, { triggers: [
    { on: ['edit'], paths: ['src/a.js'], symbols },
  ] })) });
  git('add', '-A');
  const { warnings } = await compileProject(root);
  assert.deepEqual(warnings.filter(w => w.kind === 'dead_symbol').map(w => w.value), ['ghostSymbol']);
});

test('deltadictum compile compiles the project it runs in', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory('m1')] });
  const cli = fileURLToPath(new URL('../../../src/cli.js', import.meta.url));
  const out = spawnSync(process.execPath, [cli, 'compile'], { cwd: root, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).memories, 1);
  assert.ok(existsSync(join(root, '.dd', 'local', 'v2', 'index.json')));
});

test('a project cloned without its manifest gets one, and the index matches it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-compile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createMemoryFiles(join(root, '.dd'));
  await store.commit({ put: [memory('m1')] });
  rmSync(join(root, '.dd', 'memories', 'manifest.json'));
  await compileProject(root);
  const index = JSON.parse(readFileSync(join(root, '.dd', 'local', 'v2', 'index.json'), 'utf8'));
  assert.equal(index.manifest.hash, (await store.manifest()).hash);
});
