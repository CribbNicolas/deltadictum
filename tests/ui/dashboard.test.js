import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTelemetry } from '../../src/maintenance/telemetry.js';
import { dashboard } from '../../src/ui/dashboard.js';
import { memory, project } from '../helpers/review.js';

// The dashboard reads the roll-up: deliveries (how much arrives per event, how often
// the cap was hit), the memories that fire most, sessions and tool calls, the capture funnel.
test('the dashboard sums deliveries, the cap hits, the top memories and the sessions', async t => {
  const root = await project(t, [memory('m1', { title: 'First rule' }), memory('m2', { title: 'Second rule' })]);
  const db = openTelemetry(root);
  try {
    for (const [session, first, last] of [['s1', '2026-10-14T10:00:00.000Z', '2026-10-14T11:00:00.000Z'], ['s2', '2026-10-15T10:00:00.000Z', '2026-10-15T10:30:00.000Z']]) {
      db.prepare('INSERT INTO sessions (session, first_at, last_at) VALUES (?, ?, ?)').run(session, first, last);
    }
    db.prepare('INSERT INTO events (session, kind, count) VALUES (?, ?, ?)').run('s1', 'read', 30);
    db.prepare('INSERT INTO events (session, kind, count) VALUES (?, ?, ?)').run('s2', 'edit', 20);
    const delivery = db.prepare('INSERT INTO deliveries (session, at, kind, memories, named, chars) VALUES (?, ?, ?, ?, ?, ?)');
    delivery.run('s1', '2026-10-14T10:01:00.000Z', 'read', 2, 0, 800);
    delivery.run('s1', '2026-10-14T10:02:00.000Z', 'edit', 3, 2, 9900);
    delivery.run('s2', '2026-10-15T10:01:00.000Z', 'prompt', 1, 0, 400);
    const fire = db.prepare('INSERT INTO fire_events (memory, session, via, kind, at) VALUES (?, ?, ?, ?, ?)');
    fire.run('m1', 's1', 'paths', 'read', '2026-10-14T10:01:00.000Z');
    fire.run('m1', 's2', 'keywords', 'prompt', '2026-10-15T10:01:00.000Z');
    fire.run('m2', 's1', 'paths', 'read', '2026-10-14T10:01:00.000Z');
    fire.run('gone', 's1', 'paths', 'edit', '2026-10-14T10:02:00.000Z');
    const fired = db.prepare('INSERT INTO fires (memory, session) VALUES (?, ?)');
    for (const [m, s] of [['m1', 's1'], ['m1', 's2'], ['m2', 's1'], ['gone', 's1']]) fired.run(m, s);
    const check = db.prepare('INSERT INTO checks (memory, path, outcome, at) VALUES (?, ?, ?, ?)');
    check.run('m1', 'src/a.js', 'fixed', '2026-10-14T10:05:00.000Z');
    check.run('m1', 'src/a.js', 'ignored', '2026-10-15T10:05:00.000Z');
  } finally { db.close(); }
  const report = await dashboard(root);
  assert.equal(report.limit, 10000);
  assert.deepEqual(report.sessions, { total: 2, with_deliveries: 2, tool_calls: 50 });
  assert.deepEqual(report.deliveries, { total: 3, memories_avg: 2, chars_avg: 3700, chars_max: 9900, capped: 1, capped_share: 0.33, per_100_tool_calls: 6 });
  assert.deepEqual(report.by_kind, { edit: 1, prompt: 1, read: 1 });
  // A memory deleted since it fired is left out: there is nothing left to open.
  assert.deepEqual(report.top.map(row => [row.memory, row.title, row.fires, row.sessions]),
    [['m1', 'First rule', 2, 2], ['m2', 'Second rule', 1, 1]]);
  // The live memories by kind and by the first segment of their topic.
  assert.equal(Object.values(report.kinds).reduce((a, b) => a + b, 0), 2);
  assert.equal(Object.values(report.areas).reduce((a, b) => a + b, 0), 2);
  assert.equal(typeof report.capture.proposals, 'number');
  assert.deepEqual(report.by_via, { keywords: 1, paths: 3 });
  assert.deepEqual(report.checks, { fixed: 1, ignored: 1, repeated: 0 });
  assert.deepEqual([report.coverage.live, report.coverage.delivered_ever], [2, 2]);
  assert.equal(typeof report.coverage.never_fired_with_opportunity, 'number');
  assert.deepEqual(report.by_day, [{ day: '2026-10-14', sessions: 1, deliveries: 2 }, { day: '2026-10-15', sessions: 1, deliveries: 1 }]);
});

test('an empty project has a dashboard of zeros', async t => {
  const root = await project(t, []);
  const report = await dashboard(root);
  assert.deepEqual(report.deliveries, { total: 0, memories_avg: 0, chars_avg: 0, chars_max: 0, capped: 0, capped_share: 0, per_100_tool_calls: 0 });
  assert.deepEqual(report.top, []);
});

// Blind spots: repository files read or changed in more than one session that no live memory's paths
// cover. A run's tokens are not files, and a file a memory covers is not a blind spot.
test('blind spots are files touched across sessions that no live memory covers', async t => {
  const root = await project(t, [memory('m1', { triggers: [{ on: ['edit'], paths: ['src/a.js'] }] })]);
  const db = openTelemetry(root);
  try {
    const touch = db.prepare('INSERT INTO touches (session, path, kind) VALUES (?, ?, ?)');
    for (const session of ['s1', 's2', 's3']) {
      touch.run(session, 'src/a.js', 'edit');
      touch.run(session, 'console.log', 'run');
    }
    touch.run('s1', 'src/b.js', 'edit');
    touch.run('s2', 'src/b.js', 'read');
  } finally { db.close(); }
  assert.deepEqual((await dashboard(root)).blind_spots, [{ path: 'src/b.js', sessions: 2, changed: 1 }]);
});
