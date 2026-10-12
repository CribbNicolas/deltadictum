import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compilePattern } from '../checks/pattern.cjs';
import { codeSymbols, compileProject, repoFilesOf, triggerWarnings } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { words } from '../engine/text.cjs';
import { LIVE_STATUSES, SCHEMA_VERSION, validateMemory, validRelativePath } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';
import { autoAcceptEnabled, autoAcceptReasons } from './auto-accept.js';
import { findEvidence, footprintPath, readFootprint, suggestTriggers } from './footprint.js';
import { genericReasons } from './generic.js';

// The inbox (spec section 7): the agent writes a proposal to .dd/inbox/<name>.json
// and DD answers in the same turn. Nothing the agent wrote is trusted: evidence is
// verified here, triggers are checked against the repository, and the memory is
// stored as a candidate unless every auto-accept condition holds.
export const INBOX_MAX = 16000;
const PROPOSAL_FIELDS = ['topic', 'kind', 'title', 'body', 'not_derivable', 'triggers', 'check', 'evidence', 'origin', 'revisit_when', 'review'];
const NOT_DERIVABLE_MIN = 20;
const REQUESTS = ['archive', 'revise'];

export const inboxDir = root => join(localPaths(root).dd, 'inbox');

function readConfig(root) {
  try { return JSON.parse(readFileSync(join(localPaths(root).dd, 'config.json'), 'utf8')); } catch { return {}; }
}

function projectId(root, config, memories) {
  return (typeof config.project_id === 'string' && config.project_id.trim()) || memories[0]?.project_id || basename(root);
}

function reject(name, reasons) {
  const unique = [...new Set(reasons)];
  return { reply: `DD - .dd/inbox/${name} rejected: ${unique.join(', ')}. Fix the file and write it again; it was kept.`, rejected: unique };
}

// Evidence made self-contained and verified by DD: a repository file is hashed
// now, a footprint entry is copied in with its summary, a note is kept as said.
function resolveEvidence(root, cited, footprint) {
  const reasons = [];
  const evidence = [];
  const verified = { files: 0, corrections: 0 };
  const byId = new Map(footprint.filter(e => e.id).map(e => [e.id, e]));
  for (const entry of Array.isArray(cited) ? cited : []) {
    if (entry?.type === 'file') {
      const path = String(entry.path ?? '').replaceAll('\\', '/');
      if (!validRelativePath(path)) { reasons.push('invalid_evidence_path'); continue; }
      let content;
      try { content = readFileSync(join(root, path)); } catch { reasons.push(`evidence_file_missing:${path}`); continue; }
      evidence.push({ type: 'file', path, sha256: createHash('sha256').update(content).digest('hex'),
        summary: String(entry.summary ?? 'Cited when this memory was saved.').slice(0, 500) });
      verified.files += 1;
    } else if (entry?.type === 'observation' || entry?.type === 'correction') {
      const found = byId.get(String(entry.ref ?? ''));
      const type = found?.t === 'correction' ? 'correction' : 'observation';
      if (!found || found.t === 'asked' || type !== entry.type) { reasons.push(`evidence_ref_unknown:${entry.ref ?? ''}`); continue; }
      evidence.push({ type, summary: String(found.preview ?? '').slice(0, 500) });
      if (type === 'correction') verified.corrections += 1;
    } else if (entry?.type === 'note' && typeof entry.summary === 'string' && entry.summary.trim()) {
      evidence.push({ type: 'note', summary: entry.summary.slice(0, 500) });
    } else reasons.push('invalid_evidence_type');
  }
  if (!evidence.length && !reasons.length) reasons.push('evidence_required');
  return { evidence, verified, reasons };
}

// A check must flag its violating example and pass its passing one (spec section 6).
function violates(check, text) {
  const test = source => { const pattern = compilePattern(source); if (!pattern) throw new Error('pattern'); return pattern.test(text); };
  const matched = [check.if_content, check.if_command].filter(Boolean).some(test);
  return matched && ![check.unless_content, check.unless_command].filter(Boolean).some(test);
}
function checkReasons(check) {
  if (!check?.examples) return [];
  try {
    const reasons = [];
    if (!violates(check, String(check.examples.violates))) reasons.push('check_misses_its_violating_example');
    if (violates(check, String(check.examples.passes))) reasons.push('check_flags_its_passing_example');
    return reasons;
  } catch { return ['check_pattern_invalid']; }
}

// A live memory on another topic that says nearly the same on the same anchors.
function duplicateOf(memory, live) {
  const mine = new Set(words(memory.body));
  const anchors = m => new Set(m.triggers.flatMap(c => [...(c.paths ?? []), ...(c.symbols ?? [])]));
  const ours = anchors(memory);
  for (const other of live) {
    if (other.topic === memory.topic) continue;
    const theirs = new Set(words(other.body));
    const shared = [...mine].filter(word => theirs.has(word)).length;
    const similar = shared / Math.max(1, mine.size + theirs.size - shared) >= 0.6;
    if (similar && [...anchors(other)].some(anchor => ours.has(anchor))) return other.id;
  }
  return null;
}

function storeRequest(root, file, proposal, now) {
  const name = basename(file);
  if (!REQUESTS.includes(proposal.request) || typeof proposal.target !== 'string' || typeof proposal.why !== 'string' || !proposal.why.trim()) {
    return reject(name, ['invalid_request']);
  }
  const dir = join(localPaths(root).local, 'requests');
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({ id, request: proposal.request, target: proposal.target.slice(0, 100),
    why: proposal.why.slice(0, 500), at: now.toISOString() }, null, 2)}\n`);
  rmSync(file, { force: true });
  return { reply: `DD - request ${id} (${proposal.request} ${proposal.target.slice(0, 100)}) waits for a person in the review UI.` };
}

function storedReply(memory, { suggested, warnings, accept }) {
  const state = memory.status === 'active' ? 'stored and active (DD verified its evidence)' : `stored as a candidate for review (${accept.join(', ')})`;
  const lines = [`DD - ${memory.topic}: ${state}, id ${memory.id}.`,
    `Triggers${suggested ? ' (suggested from this session; none were given)' : ''}: ${JSON.stringify(memory.triggers)}`];
  const broad = warnings.filter(w => w.kind === 'broad_glob');
  if (broad.length) lines.push(`Broad: ${broad.map(w => `${w.value} matches ${w.files} files`).join('; ')}. Narrow it if the memory applies to fewer.`);
  if (memory.replaces) lines.push(`It revises ${memory.replaces}, which stays active until a person accepts this one.`);
  return lines.join('\n');
}

export async function ingestInboxFile({ root, file, sessionId, now = new Date() }) {
  const name = basename(file);
  let size;
  try { size = statSync(file).size; } catch { return { reply: '' }; }
  if (size > INBOX_MAX) return reject(name, [`file_too_large:${size}>${INBOX_MAX}`]);
  let proposal;
  try { proposal = JSON.parse(readFileSync(file, 'utf8')); } catch { return reject(name, ['invalid_json']); }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return reject(name, ['invalid_proposal']);
  if ('request' in proposal) return storeRequest(root, file, proposal, now);
  const unknown = Object.keys(proposal).filter(key => !PROPOSAL_FIELDS.includes(key));
  if (unknown.length) return reject(name, unknown.map(key => `unknown_field:${key}`));

  const config = readConfig(root);
  const store = createMemoryFiles(localPaths(root).dd);
  const all = await store.list();
  const live = all.filter(memory => LIVE_STATUSES.includes(memory.status));
  const footprint = sessionId ? readFootprint(footprintPath(root, sessionId)) : [];
  const reasons = [];
  const notDerivable = String(proposal.not_derivable ?? '').trim();
  if (notDerivable.length < NOT_DERIVABLE_MIN || [proposal.title, proposal.body].includes(notDerivable)) reasons.push('not_derivable_required');
  const { evidence, verified, reasons: evidenceReasons } = resolveEvidence(root, proposal.evidence, footprint);
  reasons.push(...evidenceReasons);
  let triggers = Array.isArray(proposal.triggers) ? proposal.triggers : [];
  let suggested = false;
  if (!triggers.length) {
    const fix = findEvidence(footprint, { includeAsked: true }).fixes.at(-1);
    triggers = fix ? suggestTriggers(fix) : [];
    suggested = triggers.length > 0;
  }
  const previous = live.find(memory => memory.topic === proposal.topic);
  // `review` is DD's: a proposal cannot claim the migrated exemption.
  const memory = { schema_version: SCHEMA_VERSION, id: randomUUID(), project_id: projectId(root, config, all), topic: proposal.topic,
    kind: proposal.kind, status: 'candidate', title: proposal.title, body: proposal.body, not_derivable: notDerivable, triggers,
    ...(proposal.check ? { check: proposal.check } : {}), evidence, origin: proposal.origin ?? 'model_initiated',
    replaces: previous?.id ?? null, revisit_when: proposal.revisit_when ?? [], review: { migrated: false, issues: [] },
    created: now.toISOString(), updated: now.toISOString() };
  // Held to the rules of a live memory: it may activate below.
  reasons.push(...validateMemory({ ...memory, status: 'active' }));
  if (typeof memory.body === 'string') reasons.push(...genericReasons(memory));
  reasons.push(...checkReasons(memory.check));
  const repoFiles = reasons.length ? null : repoFilesOf(root);
  const found = repoFiles ? codeSymbols(root, [...new Set(triggers.flatMap(clause => clause.symbols ?? []))]) : null;
  const warnings = repoFiles ? triggerWarnings(memory, repoFiles, found ? symbol => found.has(symbol) : null) : [];
  for (const warning of warnings) if (warning.kind.startsWith('dead_')) reasons.push(`${warning.kind}:${warning.value}`);
  if (reasons.length) return reject(name, reasons);

  const duplicate = duplicateOf(memory, live);
  const accept = autoAcceptReasons({ memory, verified, warnings, duplicateOf: duplicate, enabled: autoAcceptEnabled(config) });
  const stored = { ...memory, status: accept.length ? 'candidate' : 'active',
    review: { migrated: false, issues: duplicate ? [`suspected_duplicate:${duplicate}`] : [] } };
  await store.commit({ put: [stored] });
  await compileProject(root);
  rmSync(file, { force: true });
  return { reply: storedReply(stored, { suggested, warnings, accept }), stored };
}
