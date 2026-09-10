// Deterministic, inference-free validation for a caller-DECLARED contradiction between two
// existing atoms (cross-key; same-key collisions are supersession, handled elsewhere).

export function validateExplicitContradiction(a, b) {
  if (!a || !b) return { valid: false, reason: 'atom_not_found' };
  if (a.id === b.id) return { valid: false, reason: 'self_contradiction' };
  if (a.project_id !== b.project_id) return { valid: false, reason: 'cross_project' };
  if (a.scope !== b.scope) return { valid: false, reason: 'scope_mismatch' };
  return { valid: true };
}
