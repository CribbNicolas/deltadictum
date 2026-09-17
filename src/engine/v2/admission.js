import { MEMORY_TYPES, MEMORY_SCOPES } from './constants.js';
import { hasUnsafeMemoryContent } from './sanitizer.js';

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEvidenceRefs(value) {
  return Array.isArray(value) && value.length > 0 && value.every(ref =>
    hasText(ref.source_type) && hasText(ref.source_ref) && hasText(ref.summary)
  );
}

function hasMinimumForms(value) {
  return value && hasText(value.micro) && hasText(value.short);
}

function containsUnsafePayload(payload) {
  const fields = ['title', 'trigger', 'behavior_delta', 'what', 'why'];
  return fields.some(field => hasUnsafeMemoryContent(payload[field])) ||
    Object.values(payload.retrieval_forms ?? {}).some(hasUnsafeMemoryContent);
}

export function decideAdmission(payload = {}) {
  const reasons = [];

  if (!hasText(payload.project_id)) reasons.push('missing_project_id');
  if (!MEMORY_TYPES.includes(payload.memory_type)) reasons.push('invalid_memory_type');
  if (!MEMORY_SCOPES.includes(payload.scope)) reasons.push('invalid_scope');
  if (!hasText(payload.title)) reasons.push('missing_title');
  if (!hasText(payload.trigger)) reasons.push('missing_trigger');
  if (!hasText(payload.behavior_delta)) reasons.push('missing_behavior_delta');
  if (!hasText(payload.what)) reasons.push('missing_what');
  if (!hasText(payload.why)) reasons.push('missing_why');
  if (!hasText(payload.topic_key)) reasons.push('missing_topic_key');
  if (!hasEvidenceRefs(payload.evidence_refs)) reasons.push('missing_evidence_refs');
  if (!hasMinimumForms(payload.retrieval_forms)) reasons.push('missing_retrieval_forms');
  if (containsUnsafePayload(payload)) reasons.push('unsafe_memory_content');

  if (payload.memory_type === 'anti_memory' && !/\b(do not|don't|avoid|block|warn|stop|reject|prevent|no|nunca|evitar|evita|impedir|rechazar)\b/i.test(payload.behavior_delta ?? '')) {
    reasons.push('anti_memory_requires_preventive_delta');
  }

  if (reasons.includes('missing_project_id') || reasons.includes('invalid_memory_type') || reasons.includes('invalid_scope') || reasons.includes('unsafe_memory_content') || reasons.includes('anti_memory_requires_preventive_delta')) {
    return { decision: 'block', reasons, score: 0 };
  }

  if (reasons.length > 0) {
    return { decision: 'observe', reasons, score: 0.25 };
  }

  return { decision: 'write', reasons: ['durable_contract_satisfied'], score: 1 };
}
