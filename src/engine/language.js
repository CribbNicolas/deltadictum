// Memories are authored in English whatever language the conversation uses:
// English is the cheapest to tokenise and gives lexical matching one
// vocabulary. This is a lexical check, not a language model (L1): it counts
// function words and diacritics in the prose, so code identifiers, paths and
// proper nouns neither trigger nor mask it.
const FOREIGN = new Set([
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'y', 'que', 'en', 'con', 'por', 'para',
  'como', 'pero', 'cuando', 'antes', 'despues', 'sin', 'sobre', 'entre', 'porque', 'debe', 'deben', 'hay',
  'esta', 'este', 'estos', 'estas', 'es', 'son', 'se', 'su', 'sus', 'lo', 'le', 'les', 'mas', 'muy', 'tambien',
  'ya', 'si', 'donde', 'cada', 'otro', 'otra', 'nunca', 'siempre', 'hacer', 'usar', 'agregar', 'mantener',
  // Portuguese, French, Italian, German
  'nao', 'uma', 'com', 'para', 'dos', 'das', 'le', 'les', 'des', 'du', 'et', 'est', 'avec', 'pour', 'dans',
  'il', 'di', 'della', 'che', 'non', 'der', 'die', 'das', 'und', 'nicht', 'mit', 'ist', 'fur', 'auf',
]);
const ENGLISH = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'is', 'are', 'for', 'with', 'when',
  'before', 'after', 'not', 'do', 'does', 'use', 'it', 'this', 'that', 'on', 'be', 'by', 'from', 'as', 'if',
  'must', 'should', 'never', 'always', 'keep', 'instead', 'because', 'into', 'than', 'only', 'which']);

// Spanish articles, prepositions, conjunctions and pronouns, accents stripped.
// Matching treats them as noise, as it does their English counterparts: two
// Spanish sentences share them whatever they are about.
export const SPANISH_FUNCTION_WORDS = new Set([
  'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'al', 'del', 'de', 'en', 'con', 'sin', 'por', 'para',
  'entre', 'sobre', 'desde', 'hasta', 'hacia', 'segun', 'que', 'se', 'su', 'sus', 'le', 'les', 'mi', 'mis', 'tu', 'tus',
  'es', 'son', 'esta', 'este', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'cuando', 'antes', 'despues', 'como',
  'pero', 'porque', 'si', 'ya', 'muy', 'mas', 'tambien', 'donde', 'cual', 'cuales',
]);

function prose(text) {
  // Strip what is not prose: inline code, paths, dotted and snake/camel identifiers, flags.
  return String(text ?? '').replace(/`[^`]*`/g, ' ').replace(/\S*[/\\._]\S*/g, ' ').replace(/--?\w[\w-]*/g, ' ');
}

export function looksNonEnglish(text) {
  const raw = prose(text);
  const diacritics = (raw.match(/[áéíóúñüçãõàèìòùâêôß¿¡]/gi) ?? []).length;
  const words = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]+/g) ?? [];
  let foreign = 0, english = 0;
  for (const word of words) {
    if (FOREIGN.has(word)) foreign += 1;
    if (ENGLISH.has(word)) english += 1;
  }
  const score = foreign + diacritics / 2;
  return score >= 3 && score > english;
}

export function authoredProse(payload) {
  return [payload.trigger, payload.behavior_delta, payload.why].filter(Boolean).join(' ');
}
