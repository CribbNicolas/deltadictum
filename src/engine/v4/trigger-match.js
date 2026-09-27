import { SPANISH_FUNCTION_WORDS } from '../language.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with',
  'this', 'that', 'when', 'before', 'after', 'from', 'into', 'over',
  'under', 'at', 'by', 'as', 'is', 'be', 'do', ...SPANISH_FUNCTION_WORDS,
]);

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentTokens(text) {
  return normalize(text)
    .split(' ')
    .filter(token => token.length > 1 && !STOPWORDS.has(token));
}

export function triggerActivationScore(action, trigger) {
  const normalizedAction = normalize(action);
  const normalizedTrigger = normalize(trigger);
  if (!normalizedAction || !normalizedTrigger) return 0;

  if (normalizedAction.includes(normalizedTrigger) || normalizedTrigger.includes(normalizedAction)) {
    return 1;
  }

  const triggerTokens = contentTokens(normalizedTrigger);
  if (!triggerTokens.length) return 0;
  const actionTokens = new Set(contentTokens(normalizedAction));
  const shared = triggerTokens.filter(token => actionTokens.has(token)).length;
  return shared / triggerTokens.length;
}
