import { SPANISH_FUNCTION_WORDS } from './language.js';

// Anchors are the deterministic half of retrieval: a memory that has them is
// pushed only when one of its keywords appears in the request, as whole words,
// and never when one of its not_when phrases does. Similarity can rank what an
// anchor matched; it never pushes an anchored memory on its own.
//
// A bad anchor is the one way this goes wrong, so validateAnchors refuses one
// before it is stored rather than leaving it to be noticed in use.

const ENGLISH_FUNCTION_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'this', 'that',
  'when', 'before', 'after', 'from', 'into', 'over', 'under', 'at', 'by', 'as', 'is', 'are', 'be', 'do', 'it', 'its', 'not',
  'no', 'if', 'then', 'than', 'so', 'we', 'you', 'i', 'my', 'our', 'your', 'how', 'what', 'which', 'who', 'why', 'where']);

// Words that name most requests rather than any one topic. Alone they would
// anchor a memory to half of all work; inside a longer phrase they are fine.
const GENERIC_TERMS = new Set([
  'code', 'file', 'files', 'change', 'changes', 'fix', 'bug', 'bugs', 'test', 'tests', 'update', 'implement', 'implementation',
  'add', 'remove', 'delete', 'create', 'make', 'use', 'error', 'errors', 'function', 'method', 'class', 'type', 'value', 'data',
  'project', 'feature', 'task', 'plan', 'work', 'thing', 'issue', 'problem', 'review', 'check', 'run', 'build', 'new', 'old',
  'design', 'system', 'logic', 'module', 'component', 'refactor', 'docs', 'documentation', 'config', 'setting', 'settings',
  'archivo', 'archivos', 'cambio', 'cambios', 'cambiar', 'arreglar', 'agregar', 'crear', 'borrar', 'codigo', 'funcion',
  'clase', 'proyecto', 'tarea', 'plan', 'prueba', 'pruebas', 'revisar', 'hacer', 'nuevo', 'nueva', 'sistema', 'diseno',
  'disenar', 'implementar', 'cosa', 'problema', 'dato', 'datos', 'valor', 'tipo',
]);

// Requests that carry no topic. An anchor that matches any of them would push
// its memory on a bare acknowledgement or an unrelated question.
export const GENERIC_REQUESTS = [
  'ok', 'yes', 'no', 'continue', 'go on', 'go ahead', 'next', 'done', 'thanks', 'approved', 'looks good', 'lgtm',
  'dale', 'si', 'continua', 'segui', 'seguimos', 'seguimos con el plan', 'aprobado', 'aprobado, arma el plan', 'vamos',
  'listo', 'perfecto', 'gracias', 'directo', 'hacelo', 'me cierra',
  'fix the failing tests', 'run the tests', 'commit the changes', 'review this code', 'explain this error',
  'what does this function do', 'write a short thank-you email to the team', 'arregla los tests que fallan',
  'corre los tests', 'hace commit de los cambios', 'revisa este codigo', 'explicame este error',
];

// Said to the agent in the schema and on every anchor rejection.
export const ANCHOR_HINT = 'anchors.keywords: 2-16 words or short phrases (1-3 words) whose presence in a request means this memory applies. '
  + "Each must appear in the memory's own title, trigger, trigger_variants, behavior_delta or scope; to anchor on the user's language, "
  + 'add a trigger_variant in that language containing the keyword. Use specific domain terms (resistencia, endurance, inventory grid), '
  + 'never function words or lone generic terms (code, fix, test, plan, cambiar). anchors.not_when: phrases that mean it does not apply.';

const MIN_KEYWORDS = 2;
const MAX_KEYWORDS = 16;
const MAX_WORDS = 3;
const COLLISION_AT = 3;

export function normalizeText(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
const words = value => normalizeText(value).split(' ').filter(Boolean);
const functionWord = word => ENGLISH_FUNCTION_WORDS.has(word) || SPANISH_FUNCTION_WORDS.has(word);
// Equal, or one is the other plus a plural ending. Nothing fuzzier: a match has
// to be explainable by reading the two words side by side.
const sameWord = (a, b) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

function containsPhrase(haystack, phrase) {
  if (!phrase.length || phrase.length > haystack.length) return false;
  for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    if (phrase.every((word, j) => sameWord(haystack[i + j], word))) return true;
  }
  return false;
}

export function anchorsOf(atom) {
  return { keywords: atom?.anchors?.keywords ?? [], not_when: atom?.anchors?.not_when ?? [] };
}
export const isAnchored = atom => anchorsOf(atom).keywords.length > 0;

// Normalized keywords, for full-text search: an anchored memory must be a
// candidate whenever one of its keywords is in the request.
export function anchorTerms(atom) {
  return [...new Set(anchorsOf(atom).keywords.map(normalizeText).filter(Boolean))];
}

export function matchAnchors(atom, text) {
  const haystack = words(text);
  const { keywords, not_when } = anchorsOf(atom);
  const find = list => list.filter(entry => containsPhrase(haystack, words(entry)));
  return { hits: find(keywords).map(normalizeText), blocked: find(not_when).map(normalizeText) };
}

// Where a keyword must come from: the memory's own reviewed text.
function groundingText(atom) {
  const files = (atom.applies_to?.files ?? []).map(file => file.replace(/[/\\._-]+/g, ' '));
  return words([atom.title, atom.trigger, ...(atom.trigger_variants ?? []), atom.behavior_delta,
    ...(atom.applies_to?.components ?? []), ...files].join(' '));
}

export function validateAnchors(atom) {
  const { keywords, not_when } = anchorsOf(atom);
  const reasons = [];
  if (keywords.length < MIN_KEYWORDS) reasons.push('too_few_anchor_keywords');
  if (keywords.length > MAX_KEYWORDS) reasons.push('too_many_anchor_keywords');
  if (not_when.length > MAX_KEYWORDS) reasons.push('too_many_anchor_exclusions');
  const grounding = groundingText(atom);
  const probes = GENERIC_REQUESTS.map(words);
  for (const entry of [...keywords, ...not_when]) {
    const w = words(entry);
    const label = normalizeText(entry);
    if (w.length > MAX_WORDS) { reasons.push(`long_anchor:${label}`); continue; }
    if (w.every(functionWord)) { reasons.push(`stopword_anchor:${label}`); continue; }
    if (w.length === 1 && w[0].length < 3) { reasons.push(`short_anchor:${label}`); continue; }
    if (!keywords.includes(entry)) continue; // Exclusions only need to be well formed.
    if (w.length === 1 && GENERIC_TERMS.has(w[0])) reasons.push(`generic_anchor:${label}`);
    if (!containsPhrase(grounding, w)) reasons.push(`ungrounded_anchor:${label}`);
    const fired = probes.find(probe => containsPhrase(probe, w));
    if (fired) reasons.push(`anchor_fires_on_generic_request:${label}`);
  }
  return [...new Set(reasons)];
}

// Keywords this memory shares with COLLISION_AT or more other live memories.
// Not an error (related memories share vocabulary), but a keyword that anchors
// many memories is on its way to anchoring everything.
export function anchorCollisions(atom, others) {
  const out = [];
  for (const keyword of anchorTerms(atom)) {
    const w = words(keyword);
    const count = others.filter(other => other.id !== atom.id && anchorTerms(other).some(k => containsPhrase(words(k), w) && containsPhrase(w, words(k)))).length;
    if (count >= COLLISION_AT) out.push({ keyword, memories: count });
  }
  return out;
}
