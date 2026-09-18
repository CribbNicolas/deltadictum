import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEALTH_THRESHOLDS,
  topicPrefix,
  triggerJaccard,
  indicatorStatus,
  overallStatus,
  assessDeterioration,
  emptySnapshot,
  healthThresholdsFromConfig,
  retirementCandidates,
} from '../../../src/engine/health/deterioration.js';

const NOW = '2026-09-10T00:00:00.000Z';

function atom(overrides = {}) {
  return {
    id: 'a1',
    topic_key: 'memory/admission/required-fields',
    trigger: 'before writing durable memory',
    authority: 'inferred',
    lifecycle_state: 'active',
    activation_count: 1,
    created_at: '2026-09-09T00:00:00.000Z',
    contested_at: null,
    ...overrides,
  };
}

describe('deterioration helpers', () => {
  test('default thresholds match the spec', () => {
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.live_bloat.watch, 80);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.live_bloat.deteriorated, 200);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.prefix_crowding.depth, 2);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.trigger_collision.jaccard, 0.5);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.cap_saturation.min_events, 10);
  });

  // Retirement is deliberately out of reach of the warning that diagnoses it.
  test('retirement defaults sit well above the dead_inferred warning', () => {
    assert.ok(DEFAULT_HEALTH_THRESHOLDS.retirement.min_age_days > DEFAULT_HEALTH_THRESHOLDS.dead_inferred.min_age_days * 6);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.retirement.min_age_days, 90);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.retirement.min_retrieval_events, 40);
  });

  test('a project overrides one number without restating the block', () => {
    const merged = healthThresholdsFromConfig({ health: { retirement: { min_retrieval_events: 5 } } });
    assert.equal(merged.retirement.min_retrieval_events, 5);
    assert.equal(merged.retirement.min_age_days, 90);
    assert.equal(merged.live_bloat.watch, DEFAULT_HEALTH_THRESHOLDS.live_bloat.watch);
  });

  test('topicPrefix uses the first depth segments', () => {
    assert.equal(topicPrefix('memory/admission/required-fields', 2), 'memory/admission');
    assert.equal(topicPrefix('memory/admission', 2), 'memory/admission');
  });

  test('triggerJaccard ignores stopwords and does not treat substring as 1', () => {
    const score = triggerJaccard('before writing durable memory', 'before writing tests');
    assert.ok(Math.abs(score - 1 / 4) < 1e-9);
    assert.ok(triggerJaccard('editing migrations', 'when editing migrations on postgres') < 1);
  });

  test('triggerJaccard is 1 for identical content tokens', () => {
    assert.equal(triggerJaccard('writing durable memory', 'writing durable memory'), 1);
  });

  test('indicatorStatus and overallStatus rank deteriorated > watch > healthy and ignore skipped', () => {
    assert.equal(indicatorStatus(79, 80, 200), 'healthy');
    assert.equal(indicatorStatus(80, 80, 200), 'watch');
    assert.equal(indicatorStatus(200, 80, 200), 'deteriorated');
    assert.equal(overallStatus([
      { status: 'skipped' },
      { status: 'healthy' },
      { status: 'watch' },
    ]), 'watch');
    assert.equal(overallStatus([
      { status: 'watch' },
      { status: 'deteriorated' },
    ]), 'deteriorated');
    assert.equal(overallStatus([{ status: 'skipped' }]), 'healthy');
  });
});

describe('assessDeterioration layer A', () => {
  test('three live non-colliding lessons are healthy with no retrieve events', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'a', topic_key: 'memory/admission/required-fields', trigger: 'before writing durable memory' }),
      atom({ id: 'b', topic_key: 'git/hooks/pre-commit', trigger: 'when installing git hooks' }),
      atom({ id: 'c', topic_key: 'ui/audit/form-fields', trigger: 'when editing audit form fields' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    assert.equal(report.status, 'healthy');
    assert.equal(report.live.active, 3);
    assert.equal(report.project_id, 'demo');
    assert.equal(report.generated_at, NOW);
  });

  test('30 live atoms under memory/admission trip prefix_crowding to deteriorated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = Array.from({ length: 30 }, (_, i) => atom({
      id: `p${i}`,
      topic_key: `memory/admission/item-${i}`,
      trigger: `when admitting memory item ${i}`,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const crowding = report.indicators.find(row => row.id === 'prefix_crowding');
    assert.equal(crowding.status, 'deteriorated');
    assert.equal(crowding.value, 30);
    assert.equal(report.status, 'deteriorated');
  });

  test('before writing durable memory vs before writing tests do not collide', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'a', trigger: 'before writing durable memory', topic_key: 'memory/admission/a' }),
      atom({ id: 'b', trigger: 'before writing tests', topic_key: 'memory/admission/b' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const collision = report.indicators.find(row => row.id === 'trigger_collision');
    assert.equal(collision.status, 'healthy');
    assert.equal(collision.value, 0);
  });

  test('shared content tokens at jaccard 0.5 count as a colliding pair', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'a', trigger: 'writing durable memory tests', topic_key: 'memory/admission/a' }),
      atom({ id: 'b', trigger: 'writing durable unit tests', topic_key: 'memory/admission/b' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const collision = report.indicators.find(row => row.id === 'trigger_collision');
    assert.equal(collision.status, 'watch');
    assert.equal(collision.value, 1);
    assert.equal(collision.offenders.length, 1);
  });

  test('dead inferred requires 14 days, zero activations, and inferred/observed only', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'old', activation_count: 0, created_at: '2026-08-01T00:00:00.000Z', authority: 'inferred' }),
      atom({ id: 'canon', activation_count: 0, created_at: '2026-08-01T00:00:00.000Z', authority: 'canonical', topic_key: 'memory/admission/canon' }),
      atom({ id: 'fresh', activation_count: 0, created_at: '2026-09-09T00:00:00.000Z', authority: 'inferred', topic_key: 'memory/admission/fresh' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const dead = report.indicators.find(row => row.id === 'dead_inferred');
    assert.equal(dead.value, 1);
    assert.deepEqual(dead.offenders.map(row => row.id ?? row), ['old']);
  });

  test('unresolved contest uses contested_at age', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({
        id: 'c1',
        lifecycle_state: 'contested',
        contested_at: '2026-08-01T00:00:00.000Z',
        topic_key: 'memory/admission/c1',
      }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const contest = report.indicators.find(row => row.id === 'unresolved_contest');
    assert.equal(contest.status, 'watch');
    assert.equal(contest.value, 1);
  });

  test('five superseded atoms on one topic_key are churn deteriorated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'live' }),
      ...Array.from({ length: 5 }, (_, i) => atom({
        id: `s${i}`,
        lifecycle_state: 'superseded',
        topic_key: 'memory/admission/required-fields',
      })),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const churn = report.indicators.find(row => row.id === 'supersession_churn');
    assert.equal(churn.status, 'deteriorated');
    assert.equal(churn.value, 5);
  });

  test('live_bloat counts only active+contested', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      ...Array.from({ length: 80 }, (_, i) => atom({
        id: `a${i}`,
        topic_key: `synth/load/item-${i}`,
        trigger: `module ${i} tests`,
      })),
      atom({ id: 's', lifecycle_state: 'superseded', topic_key: 'synth/load/old' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const bloat = report.indicators.find(row => row.id === 'live_bloat');
    assert.equal(bloat.value, 80);
    assert.equal(bloat.status, 'watch');
  });
});

describe('assessDeterioration layer B', () => {
  test('fewer than 10 retrieval events skips cap_saturation and overall follows A', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [atom()];
    snapshot.retrieval_events = Array.from({ length: 9 }, (_, i) => ({
      returned_atom_ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
      created_at: `2026-09-10T00:00:0${i}.000Z`,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const cap = report.indicators.find(row => row.id === 'cap_saturation');
    assert.equal(cap.status, 'skipped');
    assert.equal(cap.reason, 'insufficient_telemetry');
    assert.equal(report.status, 'healthy');
  });

  test('10 events that each return 8 ids trip cap_saturation to deteriorated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [atom()];
    snapshot.retrieval_events = Array.from({ length: 10 }, (_, i) => ({
      returned_atom_ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
      created_at: `2026-09-10T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const cap = report.indicators.find(row => row.id === 'cap_saturation');
    assert.equal(cap.status, 'deteriorated');
    assert.equal(cap.value, 1);
    assert.equal(report.status, 'deteriorated');
  });

  test('abstentions do not count as saturated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.retrieval_events = Array.from({ length: 10 }, () => ({
      returned_atom_ids: [],
      created_at: NOW,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const cap = report.indicators.find(row => row.id === 'cap_saturation');
    assert.equal(cap.status, 'healthy');
    assert.equal(cap.value, 0);
  });
});

describe('deterioration catalog cut rows', () => {
  test('observation backlog does not flip status', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [atom()];
    snapshot.observations = { unreviewed: 100, oldest_at: '2026-01-01T00:00:00.000Z' };
    const report = assessDeterioration(snapshot, NOW);
    assert.equal(report.status, 'healthy');
    assert.equal(report.observations.unreviewed, 100);
  });

  test('offenders cap at 20', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = Array.from({ length: 40 }, (_, i) => atom({
      id: `c${i}`,
      topic_key: `synth/load/item-${i}`,
      trigger: 'writing durable memory tests',
    }));
    const report = assessDeterioration(snapshot, NOW);
    const collision = report.indicators.find(row => row.id === 'trigger_collision');
    assert.ok(collision.offenders.length <= 20);
  });

  test('200 live distinct-trigger atoms assess in under 100ms', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = Array.from({ length: 200 }, (_, i) => atom({
      id: `n${i}`,
      topic_key: `synth/load/item-${i}`,
      trigger: `when running unique module ${i} suite`,
    }));
    const started = Date.now();
    const report = assessDeterioration(snapshot, NOW);
    const elapsed = Date.now() - started;
    assert.equal(report.live.active, 200);
    assert.ok(elapsed < 100, `assessed 200 live in ${elapsed}ms`);
  });
});

describe('retirement candidates', () => {
  const POLICY = { retirement: { min_age_days: 90, min_retrieval_events: 3 } };
  const OLD = '2026-01-01T00:00:00.000Z';

  function snapshotWith(atoms, eventCount = 4, eventAt = '2026-09-09T00:00:00.000Z') {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = atoms;
    snapshot.retrieval_events = Array.from({ length: eventCount }, () => ({ returned_atom_ids: [], created_at: eventAt }));
    return snapshot;
  }

  const disused = overrides => atom({ authority: 'inferred', activation_count: 0, created_at: OLD, ...overrides });

  test('selects an effective, low-authority memory whose trigger had chances and never fired', () => {
    const found = retirementCandidates(snapshotWith([disused()]), NOW, POLICY);
    assert.deepEqual(found.map(a => a.id), ['a1']);
  });

  test('authority protects', () => {
    for (const authority of ['validated', 'canonical', 'deprecated']) {
      assert.deepEqual(retirementCandidates(snapshotWith([disused({ authority })]), NOW, POLICY), []);
    }
  });

  test('one activation is enough', () => {
    assert.deepEqual(retirementCandidates(snapshotWith([disused({ activation_count: 1 })]), NOW, POLICY), []);
  });

  test('age alone retires nothing: the retrievals must postdate the memory', () => {
    const snapshot = snapshotWith([disused()], 4, '2025-06-01T00:00:00.000Z');
    assert.deepEqual(retirementCandidates(snapshot, NOW, POLICY), []);
  });

  test('too few retrievals is not disuse', () => {
    assert.deepEqual(retirementCandidates(snapshotWith([disused()], 2), NOW, POLICY), []);
  });

  test('a young memory stays, whatever the project has retrieved', () => {
    const young = disused({ created_at: '2026-09-01T00:00:00.000Z' });
    assert.deepEqual(retirementCandidates(snapshotWith([young], 50), NOW, POLICY), []);
  });

  test('a memory a pending candidate revises is under review, not disused', () => {
    const target = disused();
    const revision = atom({ id: 'c1', lifecycle_state: 'candidate', replaces: 'a1' });
    assert.deepEqual(retirementCandidates(snapshotWith([target, revision]), NOW, POLICY), []);
    // The candidate's own state is what protects it. A rejected leftover does not.
    const rejected = atom({ id: 'c2', lifecycle_state: 'rejected', replaces: 'a1' });
    assert.deepEqual(retirementCandidates(snapshotWith([target, rejected]), NOW, POLICY).map(a => a.id), ['a1']);
  });

  test('a disputed memory is a human question, not disuse', () => {
    assert.deepEqual(retirementCandidates(snapshotWith([disused({ lifecycle_state: 'contested' })]), NOW, POLICY), []);
  });

  test('candidates, superseded and already-archived memories are out of scope', () => {
    for (const lifecycle_state of ['candidate', 'superseded', 'archived', 'rejected']) {
      assert.deepEqual(retirementCandidates(snapshotWith([disused({ lifecycle_state })]), NOW, POLICY), []);
    }
  });

  test('the health report names them on the indicator that diagnosed them', () => {
    const report = assessDeterioration(snapshotWith([disused()]), NOW, { ...DEFAULT_HEALTH_THRESHOLDS, ...POLICY });
    const dead = report.indicators.find(row => row.id === 'dead_inferred');
    assert.deepEqual(dead.retirable, ['a1']);
  });

  test('the default policy retires nothing in a project with no retrieval history', () => {
    assert.deepEqual(retirementCandidates(snapshotWith([disused()], 4), NOW), []);
  });
});
