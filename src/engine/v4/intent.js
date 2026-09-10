const PROFILES = {
  factual: { form_type: 'short', memory_types: null },
  temporal: { form_type: 'short', memory_types: null },
  causal: { form_type: 'full', memory_types: null },
  policy: { form_type: 'short', memory_types: ['decision', 'claim', 'procedure'] },
  debug: { form_type: 'short', memory_types: ['lesson', 'anti_memory', 'procedure'] },
  global: { form_type: 'short', memory_types: null },
  abstain: { form_type: 'short', memory_types: null },
};

// Rules match against accent-stripped lowercase text, so vocabulary is unaccented.
const RULES = [
  { intent: 'debug', pattern: /\b(error|fail|failing|fails|bug|crash|broken|exception|falla|fallo|fallando|rompe|roto)\b/ },
  { intent: 'causal', pattern: /\b(why|cause|causa|reason|razon)\b|por\s?que\b/ },
  { intent: 'policy', pattern: /\b(policy|politica|rule|regla|invariant|invariante|forbidden|prohibido|permitido|allowed)\b/ },
  { intent: 'temporal', pattern: /\b(history|historial|timeline|since|desde)\b|\bwhen did\b|\bbefore we\b|\bafter we\b/ },
  { intent: 'global', pattern: /\b(overview|resumen|everything|catch me up|panorama)\b/ },
];

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyIntent({ action, query } = {}) {
  const text = `${normalize(action)} ${normalize(query)}`.trim();
  if (!text) return 'abstain';

  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.intent;
  }
  return 'factual';
}

export function profileFor(intent) {
  return PROFILES[intent] ?? PROFILES.factual;
}
