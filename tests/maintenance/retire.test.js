import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retireByDisuse } from '../../src/maintenance/retire.js';
import { openTelemetry } from '../../src/maintenance/telemetry.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const memory = (id, triggers, extra = {}) => ({ schema_version: 8, id, project_id: 'p', topic: `retire/${id}`, kind: 'trap', status: 'active',
  title: `Rule ${id}`, body: `Rule ${id}.`, not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null,
  revisit_when: [], review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', ...extra });

test('a memory that never fired despite opportunity retires; reviewed, measured-less and firing ones do not', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-retire-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  const store = createMemoryFiles(join(root, '.dd'));
  const narrow = [{ on: ['edit'], paths: ['src/a.js'], symbols: ['neverWritten'] }];
  await store.commit({ put: [
    memory('unused', narrow),
    memory('reviewed', narrow, { review: { migrated: false, issues: [], accepted: { by: 'person', at: null } } }),
    // An origin the agent can write is not a person's review.
    memory('claimed', narrow, { origin: 'user_explicit' }),
    memory('keywords', [{ on: ['prompt'], keywords: ['release'] }]),
    memory('used', [{ on: ['edit'], paths: ['src/a.js'] }]),
  ] });
  const db = openTelemetry(root);
  for (let i = 0; i < 20; i += 1) {
    db.prepare('INSERT INTO sessions (session) VALUES (?)').run(`s${i}`);
    db.prepare('INSERT INTO touches VALUES (?, ?, ?)').run(`s${i}`, 'src/a.js', 'edit');
    db.prepare('INSERT INTO fires VALUES (?, ?)').run('used', `s${i}`);
  }
  db.close();
  assert.deepEqual((await retireByDisuse(root, { afterSessions: 20 })).sort(), ['claimed', 'unused']);
  const after = Object.fromEntries((await store.list()).map(m => [m.id, m]));
  assert.equal(after.unused.status, 'archived');
  assert.ok(after.unused.review.issues.includes('retired_by_disuse'));
  for (const id of ['reviewed', 'keywords', 'used']) assert.equal(after[id].status, 'active', id);
  assert.deepEqual(await retireByDisuse(root, { afterSessions: 21 }), []);
});
