import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFootprint, footprintPath } from '../../src/capture/footprint.js';
import { ingestInboxFile, INBOX_MAX } from '../../src/capture/inbox.js';
import { loadIndex } from '../../src/engine/index-file.cjs';
import { createMemoryFiles } from '../../src/memory/store.js';

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-inbox-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'config.js'), 'export function parseConfig(text) { return JSON.parse(text); }\n');
  git('add', '-A');
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  return root;
}
const write = (root, name, value) => {
  const file = join(root, '.dd', 'inbox', name);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};
const proposal = (over = {}) => ({ topic: 'config/parse-config', kind: 'trap', title: 'parseConfig throws on empty text',
  body: 'Guard `parseConfig` against empty text: callers pass "" when the file is missing, and JSON.parse("") throws.',
  not_derivable: 'Callers pass an empty string only when the config file is absent, which no test covers.',
  triggers: [{ on: ['edit'], paths: ['src/config.js'], symbols: ['parseConfig'] }],
  evidence: [{ type: 'file', path: 'src/config.js' }], ...over });

test('a proposal with a hashed file, live triggers and no check is stored active, compiled, and its file removed', async t => {
  const root = repo(t);
  const file = write(root, 'a.json', proposal());
  const { reply, stored } = await ingestInboxFile({ root, file, sessionId: 's1' });
  assert.match(reply, /^DD - config\/parse-config: stored and active/);
  assert.equal(stored.status, 'active');
  assert.match(stored.evidence[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(file), false);
  assert.ok(loadIndex(root).memories[stored.id]);
});

test('without triggers, the footprint suggests them and the reply says so', async t => {
  const root = repo(t);
  const path = footprintPath(root, 's1');
  appendFootprint(path, { t: 'tool', id: 'f1', kind: 'run', runner: true, paths: [], command: 'npm test', outcome: 'failure', preview: 'Failed. parseConfig', output_identifiers: ['parseConfig'] });
  appendFootprint(path, { t: 'tool', id: 'x1', kind: 'edit', paths: ['src/config.js'], identifiers: ['parseConfig'] });
  appendFootprint(path, { t: 'tool', id: 'v1', kind: 'run', paths: [], command: 'npm test', outcome: 'validation', preview: 'Validation passed.' });
  appendFootprint(path, { t: 'asked', ids: ['f1', 'v1'] });
  const file = write(root, 'b.json', proposal({ triggers: undefined, evidence: [{ type: 'observation', ref: 'f1' }] }));
  const { reply, stored } = await ingestInboxFile({ root, file, sessionId: 's1' });
  assert.match(reply, /suggested from this session/);
  assert.deepEqual(stored.triggers[0], { on: ['edit'], paths: ['src/config.js'] });
  assert.equal(stored.evidence[0].summary, 'Failed. parseConfig');
  assert.equal(stored.status, 'candidate');
});

test('rejections name their reasons and keep the file', async t => {
  const root = repo(t);
  const cases = [
    [proposal({ not_derivable: 'short' }), /not_derivable_required/],
    [proposal({ body: 'Write tests before changing code.', title: 'Tests' }), /generic_advice/],
    [proposal({ evidence: [{ type: 'file', path: '../outside.txt' }] }), /invalid_evidence_path/],
    [proposal({ evidence: [{ type: 'file', path: 'src/gone.js' }] }), /evidence_file_missing:src\/gone\.js/],
    [proposal({ evidence: [{ type: 'observation', ref: 'nope' }] }), /evidence_ref_unknown:nope/],
    [proposal({ triggers: [{ on: ['edit'], paths: ['docs/none.md'] }] }), /dead_glob:docs\/none\.md/],
    [proposal({ extra: 1 }), /unknown_field:extra/],
    ['{ torn', /invalid_json/],
  ];
  for (const [value, reason] of cases) {
    const file = write(root, 'r.json', value);
    const { reply, rejected } = await ingestInboxFile({ root, file, sessionId: 's1' });
    assert.ok(rejected, reply);
    assert.match(reply, reason);
    assert.ok(existsSync(file));
  }
});

test('a file over 16,000 characters is rejected unread', async t => {
  const root = repo(t);
  const file = write(root, 'big.json', `{"body":"${'x'.repeat(INBOX_MAX)}"}`);
  const { reply } = await ingestInboxFile({ root, file, sessionId: 's1' });
  assert.match(reply, /file_too_large/);
});

test('a proposal on a live topic becomes a revision and waits for a person', async t => {
  const root = repo(t);
  const first = await ingestInboxFile({ root, file: write(root, 'a.json', proposal()), sessionId: 's1' });
  const { stored, reply } = await ingestInboxFile({ root, file: write(root, 'b.json', proposal({ body: 'Return {} from `parseConfig` for empty text; callers expect an object.' })), sessionId: 's1' });
  assert.equal(stored.replaces, first.stored.id);
  assert.equal(stored.status, 'candidate');
  assert.match(reply, /revises/);
});

test('a check whose examples disagree with it is rejected', async t => {
  const root = repo(t);
  const check = { on: ['edit'], paths: ['src/*.js'], if_content: 'JSON\\.parse\\(', unless_content: 'try', say: 'Guard JSON.parse.',
    examples: { violates: 'try { JSON.parse(x) } catch {}', passes: 'JSON.parse(x)' } };
  const { reply } = await ingestInboxFile({ root, file: write(root, 'c.json', proposal({ check })), sessionId: 's1' });
  assert.match(reply, /check_misses_its_violating_example/);
  assert.match(reply, /check_flags_its_passing_example/);
});

test('a request waits for a person and the inbox file is removed', async t => {
  const root = repo(t);
  const file = write(root, 'q.json', { request: 'archive', target: 'x', why: 'The parser was replaced.' });
  const { reply } = await ingestInboxFile({ root, file, sessionId: 's1' });
  assert.match(reply, /waits for a person/);
  assert.equal(existsSync(file), false);
  assert.equal((await createMemoryFiles(join(root, '.dd')).list()).length, 0);
});
