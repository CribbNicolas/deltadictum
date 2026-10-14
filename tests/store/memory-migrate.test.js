import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateProject } from '../../src/memory/migrate.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const atom = (id, over = {}) => ({
  id, project_id: 'p', schema_version: 7, capture_origin: 'model_initiated', capture_source: 'agent', memory_type: 'lesson',
  scope: 'project', title: `Title ${id}`, topic_key: `testing/${id}`, trigger: 't', behavior_delta: 'Do it.', what: 'Do it.', why: 'It broke.',
  tags: [], trigger_variants: [], applies_to: { files: ['src/a.js'], components: [], operations: [] },
  anchors: { keywords: [], not_when: [], files: [] }, assumptions: [], revisit_when: [], alternatives: [], evidence_refs: [],
  authority: 'inferred', lifecycle_state: 'active', created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z', ...over,
});
function v1Store(t, extra = []) {
  const dd = join(mkdtempSync(join(tmpdir(), 'dd-migrate-')), '.dd');
  t.after(() => rmSync(join(dd, '..'), { recursive: true, force: true }));
  const put = (path, value) => { mkdirSync(join(dd, path, '..'), { recursive: true }); writeFileSync(join(dd, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  put('atoms/testing/live.json', atom('live'));
  put('atoms/testing/bare.json', atom('bare', { applies_to: { files: [] } }));
  put('candidates/cand.json', atom('cand', { lifecycle_state: 'candidate' }));
  put('archive/old.json', atom('old', { lifecycle_state: 'superseded', topic_key: 'testing/live' }));
  put('legacy/gone.json', atom('gone', { lifecycle_state: 'legacy', topic_key: 'testing/live', legacy_reason: 'Replaced.', replaced_by: 'live' }));
  put('actions/act1.json', { id: 'act1', project_id: 'p', action: 'archive' });
  put('registry/topics.json', { entries: [], aliases: [], vocabularies: [] });
  put('relations.json', []);
  put('config.json', { project_id: 'p', budget_tokens: 600, auto_accept: { enabled: false, confidence_threshold: 0.765 } });
  put('data/index.sqlite', 'v1 index');
  put('ui.json', { port: 7735 });
  for (const [path, value] of extra) put(path, value);
  return dd;
}

test('a dry run reports the conversion and writes nothing', async t => {
  const dd = v1Store(t);
  const report = await migrateProject({ ddDir: dd, dryRun: true });
  assert.equal(report.dry_run, true);
  assert.equal(report.converted, 5);
  assert.deepEqual(report.by_status, { active: 2, candidate: 2, superseded: 1 });
  assert.deepEqual(report.by_kind, { trap: 4, failed_approach: 1 });
  assert.deepEqual(report.failures, []);
  assert.equal(report.dropped_actions, 1);
  assert.deepEqual(report.would_remove, ['atoms', 'candidates', 'archive', 'legacy', 'registry', 'actions', 'relations.json', 'data', 'ui.json']);
  assert.equal(existsSync(join(dd, 'memories')), false);
  assert.equal(existsSync(join(dd, 'atoms')), true);
});

test('a migration writes every memory, removes what only v1 read, and keeps the settings v2 reads', async t => {
  const dd = v1Store(t);
  const report = await migrateProject({ ddDir: dd });
  assert.deepEqual(report.removed, ['atoms', 'candidates', 'archive', 'legacy', 'registry', 'actions', 'relations.json', 'data', 'ui.json']);
  assert.deepEqual(report.kept, ['config.json']);
  // v1's settings are dropped; a project that had turned auto-accept off keeps it off.
  assert.deepEqual(JSON.parse(readFileSync(join(dd, 'config.json'), 'utf8')), { project_id: 'p', auto_accept: false });
  assert.deepEqual(report.config_dropped, ['budget_tokens', 'auto_accept.confidence_threshold']);
  const store = createMemoryFiles(dd);
  const all = await store.list();
  assert.deepEqual(all.map(m => m.id).sort(), ['bare', 'cand', 'gone', 'live', 'old']);
  assert.equal(all.find(m => m.id === 'gone').topic, 'testing/live-abandoned-gone');
  // An active memory with no trigger waits as a candidate.
  assert.equal(all.find(m => m.id === 'bare').status, 'candidate');
  assert.equal(all.find(m => m.id === 'live').updated, '2026-09-02T00:00:00.000Z');
  assert.equal((await store.manifest()).count, 5);
  assert.deepEqual(readdirSync(dd).sort(), ['.gitignore', 'config.json', 'memories']);
});

test('a legacy memory with no recorded replacement names the live memory on its topic', async t => {
  const dd = v1Store(t, [['legacy/orphan.json', atom('orphan', { lifecycle_state: 'legacy', topic_key: 'testing/live', legacy_reason: 'Old.', replaced_by: null })]]);
  await migrateProject({ ddDir: dd });
  const orphan = await createMemoryFiles(dd).get('orphan');
  assert.match(orphan.body, /Now: Title live$/);
});

test('a pending v1 write is applied before the migration reads, so it is not lost', async t => {
  const dd = v1Store(t);
  writeFileSync(join(dd, '.pending-write.json'), JSON.stringify({ version: 1, operations: [{ path: 'atoms/testing/late.json', value: atom('late') }] }));
  const dry = await migrateProject({ ddDir: dd, dryRun: true });
  assert.equal(dry.pending_journal, true);
  await migrateProject({ ddDir: dd });
  assert.equal((await createMemoryFiles(dd).get('late'))?.title, 'Title late');
});

test('a file the migration would not convert, or two files with one id, block it', async t => {
  const odd = v1Store(t, [['candidates/notes.txt', 'hand-written']]);
  const blocked = await migrateProject({ ddDir: odd });
  assert.deepEqual(blocked.unexpected, ['candidates/notes.txt']);
  assert.equal(existsSync(join(odd, 'memories')), false);
  const twin = v1Store(t, [['archive/copy.json', atom('live', { lifecycle_state: 'superseded' })]]);
  const report = await migrateProject({ ddDir: twin });
  assert.deepEqual(report.failures, [{ id: 'live', topic: 'testing/live', reasons: ['duplicate_id'] }]);
  assert.equal(existsSync(join(twin, 'memories')), false);
});

test('the migration keeps derived files out of git', async t => {
  const dd = v1Store(t);
  writeFileSync(join(dd, '.gitignore'), 'ui.json\n');
  await migrateProject({ ddDir: dd });
  assert.equal(readFileSync(join(dd, '.gitignore'), 'utf8'), 'ui.json\nlocal/\nmemories/manifest.json\ninbox/\n');
});

test('a second run finds nothing to migrate', async t => {
  const dd = v1Store(t);
  await migrateProject({ ddDir: dd });
  const again = await migrateProject({ ddDir: dd });
  assert.equal(again.converted, 0);
  assert.deepEqual(again.removed, []);
  assert.equal((await createMemoryFiles(dd).list()).length, 5);
});

test('one invalid memory blocks the migration: nothing is written or removed', async t => {
  const dd = v1Store(t, [['atoms/bad/x.json', atom('bad', { topic_key: 'Bad Topic' })]]);
  const report = await migrateProject({ ddDir: dd });
  assert.deepEqual(report.failures, [{ id: 'bad', topic: 'Bad Topic', reasons: ['invalid_topic'] }]);
  assert.deepEqual(report.removed, []);
  assert.equal(existsSync(join(dd, 'memories')), false);
  assert.equal(existsSync(join(dd, 'atoms')), true);
});

test('an unreadable v1 file blocks the migration and is named', async t => {
  const dd = v1Store(t);
  writeFileSync(join(dd, 'atoms', 'broken.json'), '{ nope');
  const report = await migrateProject({ ddDir: dd });
  assert.deepEqual(report.unreadable, ['atoms/broken.json']);
  assert.equal(existsSync(join(dd, 'memories')), false);
});

test('two live memories on one topic are reported, not written', async t => {
  const dd = v1Store(t, [['atoms/testing/twin.json', atom('twin', { topic_key: 'testing/live' })]]);
  const report = await migrateProject({ ddDir: dd });
  assert.deepEqual(report.failures, [{ id: 'twin', topic: 'testing/live', reasons: ['live_topic_conflict'] }]);
  assert.equal(existsSync(join(dd, 'memories')), false);
});
