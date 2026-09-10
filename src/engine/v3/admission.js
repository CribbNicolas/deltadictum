import { decideAdmission as decideV2Admission } from '../v2/admission.js';
import { isEvidenceUsableForActiveMemory } from './evidence.js';

function unique(values) {
  return [...new Set(values)];
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function decideV3Admission(payload = {}, evidenceCapsules = [], options = {}) {
  const v2Payload = {
    ...payload,
    evidence_refs: [{
      source_type: 'artifact',
      source_ref: 'v3-evidence-capsule',
      summary: 'V3 evidence capsule gate',
    }],
  };
  const base = decideV2Admission(v2Payload);
  const reasons = base.reasons.filter(reason => reason !== 'durable_contract_satisfied');

  const links = Array.isArray(payload.evidence) ? payload.evidence : [];
  const supportLinks = links.filter(link => link?.role === 'supports');
  const supportEvidence = supportLinks
    .filter(link => hasText(link.evidence_id))
    .map(link => evidenceCapsules.find(capsule => hasText(capsule.id) && capsule.id === link.evidence_id))
    .filter(Boolean);

  if (supportLinks.length === 0 || supportEvidence.length !== supportLinks.length) {
    reasons.push('evidence_required');
  }

  for (const capsule of supportEvidence) {
    if (hasText(payload.project_id) && hasText(capsule.project_id) && capsule.project_id !== payload.project_id) {
      return {
        decision: 'block',
        reasons: unique([...reasons, 'evidence_scope_violation']),
        score: 0,
        statusCode: 403,
      };
    }

    const usable = isEvidenceUsableForActiveMemory(capsule, options.now ?? new Date().toISOString());
    if (!usable.usable) reasons.push(usable.reason);
  }

  if (base.decision === 'block') {
    return { ...base, reasons: unique([...base.reasons, ...reasons]) };
  }

  if (reasons.length > 0) {
    return { decision: 'observe', reasons: unique(reasons), score: 0.25 };
  }

  return { decision: 'write', reasons: ['durable_contract_satisfied'], score: 1 };
}
