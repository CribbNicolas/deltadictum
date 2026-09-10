const FALLBACK_ORDER = {
  full: ['full', 'short', 'micro'],
  short: ['short', 'micro'],
  micro: ['micro'],
};

export function selectForm(formsForAtom, preferredType, remainingBudget) {
  const order = FALLBACK_ORDER[preferredType] ?? FALLBACK_ORDER.short;

  for (const formType of order) {
    const form = (formsForAtom ?? []).find(candidate => candidate.form_type === formType);
    if (form && form.token_estimate <= remainingBudget) return form;
  }

  return null;
}
