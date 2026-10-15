// Auto-accept (spec section 7): a candidate activates without review only when
// DD itself verified its grounds — a repository file it hashed or a correction it
// recorded — its triggers are all live, it has no check, and it neither
// duplicates a live memory nor revises one. Every unmet condition is named.
export function autoAcceptReasons({ memory, verified, warnings = [], duplicateOf = null, enabled = true, triggersVerified = true }) {
  const reasons = [];
  if (!enabled) reasons.push('auto_accept_disabled');
  if (!verified.files && !verified.corrections) reasons.push('no_verified_evidence');
  // Without git nothing says the triggers can fire.
  if (!triggersVerified) reasons.push('triggers_unverified');
  if (warnings.some(w => w.kind === 'dead_glob' || w.kind === 'dead_symbol')) reasons.push('dead_trigger');
  if (memory.check) reasons.push('has_check');
  if (duplicateOf) reasons.push('suspected_duplicate');
  if (memory.replaces) reasons.push('revision');
  return reasons;
}

// On by default (spec section 7). v1's confidence threshold has no meaning here.
export function autoAcceptEnabled(config) {
  const setting = config?.auto_accept;
  return !(setting === false || setting?.enabled === false);
}
