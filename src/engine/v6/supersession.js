// Deterministic, inference-free. Decides whether a write to an already-live topic_key
// supersedes the existing atom or is a no-op update. "Material change" = the agent-facing
// substance (behavior_delta / what / why) differs after trimming.

function norm(value) {
  return String(value ?? '').trim();
}

const MATERIAL_FIELDS = ['behavior_delta', 'what', 'why'];

export function decideSupersession(existing, incoming) {
  if (norm(incoming.supersedes) && norm(incoming.supersedes) === norm(existing.id)) {
    return { action: 'supersede', reasons: ['explicit_supersedes'] };
  }
  const changed = MATERIAL_FIELDS.filter(field => norm(existing[field]) !== norm(incoming[field]));
  if (changed.length > 0) {
    return { action: 'supersede', reasons: changed.map(field => `changed_${field}`) };
  }
  return { action: 'update', reasons: ['no_material_change'] };
}
