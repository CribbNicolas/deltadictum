import { randomUUID } from 'node:crypto';
import { sanitizeText } from '../engine/v2/sanitizer.js';

const now = () => new Date().toISOString();
const since = days => new Date(Date.now() - days * 86400000).toISOString();

export function createTelemetry(index, git) {
  const db = index.db;
  async function prune() {
    const config = await git.loadConfig();
    const obs = config.capture;
    const telemetry = config.telemetry;
    db.prepare('DELETE FROM memory_observations WHERE observed_at < ?').run(since(obs.retention_days));
    db.prepare('DELETE FROM memory_observations WHERE id IN (SELECT id FROM memory_observations ORDER BY observed_at DESC LIMIT -1 OFFSET ?)').run(obs.max_observations);
    // memory_contradiction_log is deliberately absent: it records Level 3 human
    // decisions and their rationale, which is audit, not telemetry. A row is
    // written only when a caller declares a contradiction or a human resolves
    // one, so the table cannot grow the way the observation and retrieval logs
    // do, and discarding a resolution would destroy the record of why an
    // effective memory won.
    for (const table of ['memory_feedback', 'memory_retrieval_events', 'memory_admission_decisions']) {
      db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).run(since(telemetry.retention_days));
      db.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} ORDER BY created_at DESC LIMIT -1 OFFSET ?)`).run(telemetry.max_events);
    }
    db.prepare('DELETE FROM session_deliveries WHERE delivered_at < ?').run(since(config.session.retention_hours / 24));
    db.prepare('DELETE FROM session_deliveries WHERE rowid IN (SELECT rowid FROM session_deliveries ORDER BY delivered_at DESC LIMIT -1 OFFSET ?)').run(config.session.max_entries);
    db.prepare('DELETE FROM capture_sessions WHERE updated_at < ?').run(since(config.session.retention_hours / 24));
    db.prepare('DELETE FROM capture_prompts WHERE updated_at < ?').run(since(config.session.retention_hours / 24));
    db.prepare('DELETE FROM capture_prompts WHERE rowid IN (SELECT rowid FROM capture_prompts ORDER BY updated_at DESC LIMIT -1 OFFSET ?)').run(config.session.max_entries);
  }

  async function putObservation(observation) {
    const row = { id: randomUUID(), project_id: observation.project_id, source_type: observation.source_type,
      source_ref: observation.source_ref, raw_preview: sanitizeText(observation.raw_preview).slice(0, 800) || 'Observation',
      observed_at: now(), promotion_status: 'unreviewed', sanitization_status: 'sanitized', metadata: observation.metadata ?? {} };
    db.prepare(`INSERT INTO memory_observations VALUES (@id,@project_id,@source_type,@source_ref,@raw_preview,@observed_at,@promotion_status,@sanitization_status,@metadata)`)
      .run({ ...row, metadata: JSON.stringify(row.metadata) });
    await prune();
    return row;
  }
  async function getObservation(id) {
    const row = db.prepare('SELECT * FROM memory_observations WHERE id = ?').get(id);
    return row ? { ...row, metadata: JSON.parse(row.metadata) } : null;
  }
  // Read-only for review. An observation is evidence, not knowledge: the audit
  // UI shows what was recorded so a reviewer can judge a proposal citing it, and
  // offers no action on it, because promoting evidence is not a thing that can
  // happen.
  async function listObservations(projectId, limit = 50) {
    return db.prepare(`SELECT id,source_type,source_ref,raw_preview,observed_at,metadata FROM memory_observations
      WHERE project_id=? ORDER BY observed_at DESC, id DESC LIMIT ?`).all(projectId, Math.min(Number(limit) || 50, 200))
      .map(row => ({ ...row, metadata: JSON.parse(row.metadata) }));
  }
  async function recentObservations(projectId, sessionId) {
    if (!sessionId) return [];
    return db.prepare(`SELECT id,source_type,source_ref FROM memory_observations
      WHERE project_id=? AND json_extract(metadata,'$.session_id')=?
      ORDER BY observed_at DESC, id DESC LIMIT 3`).all(projectId, sessionId);
  }
  async function putFeedback(event) {
    const row = { id: randomUUID(), ...event, created_at: now() };
    db.prepare(`INSERT OR IGNORE INTO memory_feedback (id,project_id,atom_id,task_id,outcome,summary,evidence,verification,created_at)
      VALUES (@id,@project_id,@atom_id,@task_id,@outcome,@summary,@evidence,@verification,@created_at)`)
      .run({ ...row, evidence: JSON.stringify(row.evidence) });
    const stored = db.prepare('SELECT * FROM memory_feedback WHERE project_id=? AND atom_id=? AND task_id=?').get(event.project_id, event.atom_id, event.task_id);
    await prune();
    return { id: stored.id, outcome: stored.outcome, verification: stored.verification, recorded: true };
  }
  async function feedbackSummary(ids, projectId) {
    if (!ids.length) return {};
    const rows = db.prepare(`SELECT atom_id, outcome, COUNT(*) AS n FROM memory_feedback
      WHERE project_id=? AND atom_id IN (${ids.map(() => '?').join(',')}) AND verification IN ('artifact_verified','human_accepted')
      GROUP BY atom_id,outcome`).all(projectId, ...ids);
    const result = {};
    for (const row of rows) { result[row.atom_id] ??= {}; result[row.atom_id][row.outcome] = row.n; }
    return result;
  }
  async function listFeedback(projectId, atomId) {
    const rows = atomId ? db.prepare('SELECT * FROM memory_feedback WHERE project_id=? AND atom_id=? ORDER BY created_at DESC LIMIT 100').all(projectId, atomId)
      : db.prepare('SELECT * FROM memory_feedback WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(projectId);
    return rows.map(row => ({ ...row, evidence: JSON.parse(row.evidence) }));
  }
  async function reviewFeedback(id, projectId, accepted) {
    db.prepare('UPDATE memory_feedback SET verification=? WHERE id=? AND project_id=?').run(accepted ? 'human_accepted' : 'human_dismissed', id, projectId);
  }
  async function wasDelivered(projectId, sessionId, atomId, revision) {
    const row = db.prepare('SELECT revision,delivered_at FROM session_deliveries WHERE project_id=? AND session_id=? AND atom_id=?').get(projectId, sessionId, atomId);
    return row?.revision === revision && row.delivered_at >= since(1);
  }
  async function markDelivered(projectId, sessionId, atomId, revision) {
    db.prepare(`INSERT INTO session_deliveries VALUES (?,?,?,?,?) ON CONFLICT(project_id,session_id,atom_id)
      DO UPDATE SET revision=excluded.revision,delivered_at=excluded.delivered_at`).run(projectId, sessionId, atomId, revision, now());
  }
  async function clearSessionDeliveries(projectId, sessionId) {
    db.prepare('DELETE FROM session_deliveries WHERE project_id=? AND session_id=?').run(projectId, sessionId);
  }
  async function beginCaptureTurn(projectId, sessionId) {
    if (!sessionId) return;
    db.prepare(`INSERT INTO capture_prompts (project_id,session_id,stopped,updated_at) VALUES (?,?,0,?)
      ON CONFLICT(project_id,session_id) DO UPDATE SET stopped=0,updated_at=excluded.updated_at`).run(projectId, sessionId, now());
  }
  async function claimCapturePrompt(projectId, sessionId, observations = []) {
    if (!sessionId) return true;
    const evidenceIds = JSON.stringify(observations.map(o => o.id).sort());
    return index.transaction(() => {
      const previous = db.prepare('SELECT stopped,evidence_ids FROM capture_prompts WHERE project_id=? AND session_id=?').get(projectId, sessionId);
      if (previous?.stopped || (observations.length && previous?.evidence_ids === evidenceIds)) return false;
      db.prepare(`INSERT INTO capture_prompts (project_id,session_id,stopped,evidence_ids,updated_at) VALUES (?,?,1,?,?)
        ON CONFLICT(project_id,session_id) DO UPDATE SET stopped=1,evidence_ids=excluded.evidence_ids,updated_at=excluded.updated_at`)
        .run(projectId, sessionId, evidenceIds, now());
      return true;
    });
  }
  return { prune, putObservation, getObservation, listObservations, recentObservations, putFeedback, feedbackSummary, listFeedback, reviewFeedback,
    wasDelivered, markDelivered, clearSessionDeliveries, beginCaptureTurn, claimCapturePrompt };
}
