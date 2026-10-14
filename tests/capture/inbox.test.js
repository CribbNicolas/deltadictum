import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(root, 'README.md'), '# Project\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.env\n');
  git('add', '-A');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'x.js'), 'x');
  writeFileSync(join(root, '.env'), 'TOKEN=1');
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
  assert.deepEqual(stored.review.accepted, { by: 'dd', at: stored.created });
  assert.equal(existsSync(file), false);
  assert.ok(loadIndex(root).memories[stored.id]);
});

// A correction is verified evidence only when it is about the memory and follows
// something the agent did (owner, 2026-10-13): "No, gracias" or a "No," that opens
// the session corrects no work.
test('a correction activates a memory only when it names the memory and follows an action', async t => {
  const cases = [
    { name: 'related, after an action', acted: true, text: 'No, parseConfig has to handle an empty string', status: 'active' },
    { name: 'unrelated', acted: true, text: 'No, gracias, dale', status: 'candidate' },
    { name: 'before any action', acted: false, text: 'No, parseConfig has to handle an empty string', status: 'candidate' },
  ];
  for (const { name, acted, text, status } of cases) {
    const root = repo(t);
    const path = footprintPath(root, 's1');
    if (acted) appendFootprint(path, { t: 'tool', id: 'e1', at: '2026-10-13T10:00:00.000Z', kind: 'edit', paths: ['src/config.js'], identifiers: [] });
    appendFootprint(path, { t: 'correction', id: 'c1', at: '2026-10-13T10:01:00.000Z', preview: `User correction. ${text}` });
    const file = write(root, 'a.json', proposal({ evidence: [{ type: 'correction', ref: 'c1' }] }));
    const { stored } = await ingestInboxFile({ root, file, sessionId: 's1' });
    assert.equal(stored?.status, status, name);
  }
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
  assert.equal(stored.review.accepted, undefined);
});

// A /dd:save about something else must not inherit the session's last fix.
test('without triggers or a cited fix, the proposal is sent back with the suggestions to adopt', async t => {
  const root = repo(t);
  const path = footprintPath(root, 's1');
  appendFootprint(path, { t: 'tool', id: 'f1', kind: 'run', runner: true, paths: [], command: 'npm test', outcome: 'failure', preview: 'Failed.', output_identifiers: [] });
  appendFootprint(path, { t: 'tool', id: 'x1', kind: 'edit', paths: ['src/config.js'], identifiers: [] });
  appendFootprint(path, { t: 'tool', id: 'v1', kind: 'run', runner: true, paths: [], command: 'npm test', outcome: 'validation', preview: 'Validation passed.' });
  const file = write(root, 'u.json', proposal({ triggers: undefined, evidence: [{ type: 'file', path: 'README.md' }] }));
  const { reply, rejected } = await ingestInboxFile({ root, file, sessionId: 's1' });
  assert.deepEqual(rejected, ['triggers_required']);
  assert.match(reply, /Suggested from this session's last fix: \[\{"on":\["edit"\],"paths":\["src\/config\.js"\]\}\]/);
});

test('rejections name their reasons and keep the file', async t => {
  const root = repo(t);
  const cases = [
    [proposal({ not_derivable: 'short' }), /not_derivable_required/],
    [proposal({ body: 'Write tests before changing code.', title: 'Tests' }), /generic_advice/],
    [proposal({ evidence: [{ type: 'file', path: '../outside.txt' }] }), /invalid_evidence_path/],
    [proposal({ evidence: [{ type: 'file', path: '/etc/passwd' }] }), /invalid_evidence_path/],
    [proposal({ evidence: [{ type: 'file', path: 'C:/Windows/win.ini' }] }), /invalid_evidence_path/],
    [proposal({ evidence: [{ type: 'file', path: '.git/HEAD' }] }), /evidence_not_a_repository_file:\.git\/HEAD/],
    [proposal({ evidence: [{ type: 'file', path: '.dd/inbox/r.json' }] }), /evidence_not_a_repository_file/],
    [proposal({ evidence: [{ type: 'file', path: 'node_modules/x.js' }] }), /evidence_not_a_repository_file:node_modules\/x\.js/],
    [proposal({ evidence: [{ type: 'file', path: '.env' }] }), /evidence_not_a_repository_file:\.env/],
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

// Evidence proves integrity, not relevance: a file counts toward auto-accept only
// when the memory's triggers cover it or the session touched it.
test('a repository file unrelated to the memory is kept as evidence but does not activate it', async t => {
  const root = repo(t);
  const { stored, reply } = await ingestInboxFile({ root, file: write(root, 'a.json', proposal({ evidence: [{ type: 'file', path: 'README.md' }] })), sessionId: 's1' });
  assert.equal(stored.status, 'candidate');
  assert.match(reply, /no_verified_evidence/);
  assert.match(stored.evidence[0].sha256, /^[0-9a-f]{64}$/);
});

test('a symlink is not evidence', async t => {
  const root = repo(t);
  const { symlinkSync } = await import('node:fs');
  try { symlinkSync(join(root, 'src', 'config.js'), join(root, 'src', 'link.js')); } catch { t.skip('symlinks need privileges here'); return; }
  spawnSync('git', ['-C', root, 'add', '-A']);
  const { reply } = await ingestInboxFile({ root, file: write(root, 'a.json', proposal({ evidence: [{ type: 'file', path: 'src/link.js' }] })), sessionId: 's1' });
  assert.match(reply, /evidence_not_a_repository_file:src\/link\.js/);
});

test('without git, triggers cannot be verified and nothing auto-activates', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-inbox-nogit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'config.js'), 'export function parseConfig() {}\n');
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  const { stored, reply } = await ingestInboxFile({ root, file: write(root, 'a.json', proposal()), sessionId: 's1' });
  assert.equal(stored.status, 'candidate');
  assert.match(reply, /triggers_unverified/);
});

// Once stored, the inbox file goes: writing it again must not revise the memory
// it just became, even when the index could not be rebuilt.
test('a memory stored when the index cannot be rebuilt is still reported, and its file removed', async t => {
  const root = repo(t);
  const file = write(root, 'a.json', proposal());
  const { reply, stored } = await ingestInboxFile({ root, file, sessionId: 's1', compile: async () => { throw new Error('EPERM'); } });
  assert.equal(stored.status, 'active');
  assert.match(reply, /stored and active/);
  assert.match(reply, /index is rebuilt at the next session start/);
  assert.equal(existsSync(file), false);
});

// A rejected proposal stays in the inbox: it must never show up in git status.
test('the first ingestion keeps the inbox out of git, even when it rejects', async t => {
  const root = repo(t);
  await ingestInboxFile({ root, file: write(root, 'r.json', '{ torn'), sessionId: 's1' });
  assert.match(readFileSync(join(root, '.dd', '.gitignore'), 'utf8'), /^inbox\/$/m);
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

// A rewrite of a proposal still waiting for review replaces it: a topic never
// holds a pending candidate beside an active memory a person could not accept over.
// Archiving is not deleting (INV-09): the replaced candidate keeps its file.
test('a proposal on a topic whose candidate is still pending replaces that candidate, which is archived', async t => {
  const root = repo(t);
  const first = await ingestInboxFile({ root, file: write(root, 'a.json', proposal({ evidence: [{ type: 'note', summary: 'Seen while debugging.' }] })), sessionId: 's1' });
  assert.equal(first.stored.status, 'candidate');
  const second = await ingestInboxFile({ root, file: write(root, 'b.json', proposal()), sessionId: 's1' });
  assert.equal(second.stored.status, 'active');
  assert.deepEqual(second.stored.review.issues, [`supersedes_candidate:${first.stored.id}`]);
  assert.match(second.reply, new RegExp(`replaces the pending candidate ${first.stored.id}`));
  const onTopic = (await createMemoryFiles(join(root, '.dd')).list()).filter(m => m.topic === 'config/parse-config');
  assert.deepEqual(onTopic.map(m => m.id).sort(), [first.stored.id, second.stored.id].sort());
  const replaced = onTopic.find(m => m.id === first.stored.id);
  assert.equal(replaced.status, 'archived');
  assert.ok(replaced.review.issues.includes(`replaced_by_candidate:${second.stored.id}`));
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
