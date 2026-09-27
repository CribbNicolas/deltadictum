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
  + 'never function words or lone generic terms (code, fix, test, plan, cambiar). anchors.not_when: phrases that mean it does not apply. '
  + 'anchors.files: exact files from applies_to.files whose every read or edit needs this memory; never a folder, and not a file most work touches.';

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
  return { keywords: atom?.anchors?.keywords ?? [], not_when: atom?.anchors?.not_when ?? [], files: atom?.anchors?.files ?? [] };
}
export const isAnchored = atom => anchorsOf(atom).keywords.length > 0;

// Normalized keywords, for full-text search: an anchored memory must be a
// candidate whenever one of its keywords is in the request.
export function anchorTerms(atom) {
  return [...new Set(anchorsOf(atom).keywords.map(normalizeText).filter(Boolean))];
}

// A knowledge file can be edited by hand, past validation, so delivery uses only
// the entries that would pass it. Checked once per atom object: the store's
// anchored list is cached, so the hot path pays for this once per change.
const usable = new WeakMap();
function usableAnchors(atom) {
  if (atom && typeof atom === 'object' && usable.has(atom)) return usable.get(atom);
  const { keywords, not_when, files } = anchorsOf(atom);
  const grounding = groundingText(atom ?? {});
  const result = { keywords: keywords.filter(entry => !entryProblems(entry, true, grounding).length),
    not_when: not_when.filter(entry => !entryProblems(entry, false, grounding).length),
    files: files.filter(file => !fileProblems(atom ?? {}, file).length).map(slashed) };
  if (atom && typeof atom === 'object') usable.set(atom, result);
  return result;
}

// Files the request names (project-relative) that are anchor files of the memory.
export function matchAnchors(atom, text, requestFiles = []) {
  const haystack = words(text);
  const { keywords, not_when, files } = usableAnchors(atom);
  const find = list => list.filter(entry => containsPhrase(haystack, words(entry)));
  const named = new Set(requestFiles.map(slashed));
  return { hits: find(keywords).map(normalizeText), blocked: find(not_when).map(normalizeText), files: files.filter(file => named.has(file)) };
}

const slashed = path => String(path).replaceAll('\\', '/').replace(/^\.\//, '');
// An anchor file pushes on every request that names it, so it must be one exact
// file the memory is scoped to, never a folder.
function fileProblems(atom, file) {
  if (/[*?[\]{}]/.test(file)) return [`folder_anchor_file:${file}`];
  if (!(atom.applies_to?.files ?? []).map(slashed).includes(slashed(file))) return [`anchor_file_outside_scope:${file}`];
  return [];
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
  for (const entry of keywords) reasons.push(...entryProblems(entry, true, grounding));
  for (const entry of not_when) reasons.push(...entryProblems(entry, false, grounding));
  for (const file of anchorsOf(atom).files) reasons.push(...fileProblems(atom, file));
  if (anchorsOf(atom).files.length > MAX_KEYWORDS) reasons.push('too_many_anchor_files');
  return [...new Set(reasons)];
}

const PROBES = GENERIC_REQUESTS.map(words);
// What is wrong with one keyword (isKeyword) or one not_when phrase.
function entryProblems(entry, isKeyword, grounding) {
  const w = words(entry);
  const label = normalizeText(entry);
  if (!w.length) return [`stopword_anchor:${label}`];
  if (w.length > MAX_WORDS) return [`long_anchor:${label}`];
  if (w.every(functionWord)) return [`stopword_anchor:${label}`];
  if (w.length === 1 && w[0].length < 3) return [`short_anchor:${label}`];
  // A flag such as -e survives normalization as one letter, which then matches
  // whatever word follows the other one ("node -e" matches "node export").
  // A lone digit is meaningful ("snapshot 4"), so only letters count.
  if (w.length > 1 && w.some(word => /^[a-z]$/.test(word))) return [`single_letter_anchor:${label}`];
  if (!isKeyword) return []; // Exclusions only need to be well formed.
  const problems = [];
  if (w.length === 1 && GENERIC_TERMS.has(w[0])) problems.push(`generic_anchor:${label}`);
  if (!containsPhrase(grounding, w)) problems.push(`ungrounded_anchor:${label}`);
  if (PROBES.some(probe => containsPhrase(probe, w))) problems.push(`anchor_fires_on_generic_request:${label}`);
  return problems;
}

// What the agent is told at filing: keywords and files that already anchor several memories.
export function anchorWarnings(atom, others) {
  return [...anchorCollisions(atom, others).map(c => `keyword "${c.keyword}" also anchors ${c.memories} other memories`),
    ...anchorFileCollisions(atom, others).map(c => `file ${c.file} already anchors ${c.memories} other memories; every read or edit of it would push all of them`)];
}

// Anchor files this memory shares with COLLISION_AT or more other live memories:
// a file most work touches, which would push all of them on every read or edit.
export function anchorFileCollisions(atom, others) {
  return anchorsOf(atom).files.map(slashed).map(file => ({ file,
    memories: others.filter(other => other.id !== atom.id && anchorsOf(other).files.map(slashed).includes(file)).length }))
    .filter(c => c.memories >= COLLISION_AT);
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
