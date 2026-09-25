const KEY_PATTERN = /^[a-z0-9_-]+(\/[a-z0-9_-]+){1,3}$/;
// Stated to the agent at the schema and on rejection: a bare code gives it nothing to correct.
export const KEY_FORMAT_HINT = 'topic_key must be 2-4 lowercase segments joined by "/", each of a-z, 0-9, "_" or "-" (e.g. "rules/holdings/empty-on-death"); no dots, spaces or colons.';

export function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function validateKeyFormat(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return { valid: false, reason: 'empty_key' };
  if (!KEY_PATTERN.test(normalized)) return { valid: false, reason: 'invalid_key_format' };
  return { valid: true, normalized };
}

export function domainOf(key) {
  return normalizeKey(key).split('/')[0];
}

export function validateAgainstVocabulary(key, tags, vocab = {}) {
  const format = validateKeyFormat(key);
  if (!format.valid) return format;

  const domains = new Set((vocab.domains ?? []).map(normalizeKey));
  if (!domains.has(domainOf(format.normalized))) return { valid: false, reason: 'unknown_domain' };

  const tagVocab = new Set((vocab.tags ?? []).map(normalizeKey));
  for (const tag of tags ?? []) {
    if (!tagVocab.has(normalizeKey(tag))) return { valid: false, reason: 'unknown_tag', tag };
  }
  return { valid: true, normalized: format.normalized };
}
