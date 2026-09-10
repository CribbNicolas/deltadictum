export const EVIDENCE_SOURCE_TYPES = ['test_log', 'tool_output', 'file', 'diff', 'trace', 'decision', 'user_approval', 'artifact'];
export const EVIDENCE_SENSITIVITIES = ['public', 'project', 'private', 'secret'];
export const EVIDENCE_HASH_STATUSES = ['not_checked', 'matched', 'mismatched', 'unavailable'];
export const EVIDENCE_ROLES = ['supports', 'refutes', 'context', 'supersedes_basis'];

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value) {
  return hasText(value) && !Number.isNaN(Date.parse(value));
}

function hasInvalidHash(value) {
  return hasText(value) && !/^[0-9a-fA-F]{64}$/.test(value);
}

export function validateEvidenceCapsule(capsule = {}) {
  const reasons = [];
  if (!hasText(capsule.project_id)) reasons.push('missing_project_id');
  if (!EVIDENCE_SOURCE_TYPES.includes(capsule.source_type)) reasons.push('invalid_source_type');
  if (!hasText(capsule.source_ref)) reasons.push('missing_source_ref');
  if (!isValidDate(capsule.observed_at)) reasons.push('invalid_observed_at');
  if (!isValidDate(capsule.valid_from)) reasons.push('invalid_valid_from');
  if (capsule.valid_until !== null && capsule.valid_until !== undefined) {
    if (!isValidDate(capsule.valid_until) || !isValidDate(capsule.valid_from) || Date.parse(capsule.valid_until) <= Date.parse(capsule.valid_from)) {
      reasons.push('invalid_valid_until');
    }
  }
  if (!hasText(capsule.summary)) reasons.push('missing_summary');
  if (hasInvalidHash(capsule.hash)) reasons.push('invalid_hash');
  if (!EVIDENCE_HASH_STATUSES.includes(capsule.hash_status ?? 'not_checked')) reasons.push('invalid_hash_status');
  if (!EVIDENCE_SENSITIVITIES.includes(capsule.sensitivity ?? 'project')) reasons.push('invalid_sensitivity');
  return { valid: reasons.length === 0, reasons };
}

export function isEvidenceUsableForActiveMemory(capsule = {}, now = new Date().toISOString()) {
  const validation = validateEvidenceCapsule(capsule);
  if (!validation.valid) return { usable: false, reason: validation.reasons[0] };
  if (capsule.hash_status === 'mismatched') return { usable: false, reason: 'evidence_hash_mismatch' };
  if (Date.parse(capsule.observed_at) > Date.parse(now)) return { usable: false, reason: 'future_observed_evidence' };
  if (Date.parse(capsule.valid_from) > Date.parse(now)) return { usable: false, reason: 'not_yet_valid_evidence' };
  if (capsule.valid_until && Date.parse(capsule.valid_until) <= Date.parse(now)) return { usable: false, reason: 'expired_evidence' };
  return { usable: true, reason: null };
}

export function redactEvidenceCapsule(capsule = {}, permissions = {}) {
  const sensitivity = capsule.sensitivity ?? 'project';
  const canRead = sensitivity === 'public' || sensitivity === 'project' ||
    (sensitivity === 'private' && permissions.canReadPrivate === true) ||
    (sensitivity === 'secret' && permissions.canReadSecret === true);
  if (canRead) return { ...capsule, redacted: false };
  return {
    id: capsule.id,
    project_id: capsule.project_id,
    source_type: capsule.source_type,
    source_ref: capsule.source_ref,
    observed_at: capsule.observed_at,
    valid_from: capsule.valid_from,
    valid_until: capsule.valid_until,
    sensitivity,
    summary: '[redacted]',
    metadata: {},
    redacted: true,
  };
}
