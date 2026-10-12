import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { exampleProblems } from '../checks/check.cjs';
import { createMatcher } from '../checks/pattern.cjs';
import { codeSymbols, compileProject, repoFilesOf, triggerWarnings, untrackedFilesOf } from '../engine/compile.js';
import { globToRegExp } from '../engine/clause.cjs';
import { localPaths } from '../engine/locate.cjs';
import { words } from '../engine/text.cjs';
import { LIVE_STATUSES, SCHEMA_VERSION, validateMemory, validRelativePath } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';
import { autoAcceptEnabled, autoAcceptReasons } from './auto-accept.js';
import { findEvidence, footprintPath, readFootprint, suggestTriggers } from './footprint.js';
import { genericReasons, namedSymbols } from './generic.js';

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

function reject(name, reasons, hint = null) {
  const unique = [...new Set(reasons)];
  const reply = `DD - .dd/inbox/${name} rejected: ${unique.join(', ')}. Fix the file and write it again; it was kept.`;
  return { reply: hint ? `${reply}\n${hint}` : reply, rejected: unique };
}

// Evidence made self-contained and verified by DD: a repository file is hashed
// now, a footprint entry is copied in with its summary, a note is kept as said.
// The files git lists for the repository: tracked, and untracked but not ignored.
// null without git, when nothing can say what belongs to the repository.
function repositoryListing(root) {
  const tracked = repoFilesOf(root);
  if (!tracked) return null;
  return { tracked, all: new Set([...tracked, ...(untrackedFilesOf(root) ?? [])]) };
}

const EVIDENCE_FILE_MAX = 1024 * 1024;

// Evidence made self-contained and verified by DD: a repository file is hashed
// now, a footprint entry is copied in with its summary, a note is kept as said.
// A file is evidence only if it is a regular file the repository lists, outside
// .git/ and .dd/: never a symlink, an ignored file or the proposal itself.
function resolveEvidence(root, cited, footprint, listing) {
  const reasons = [];
  const evidence = [];
  const files = [];
  let corrections = 0;
  const byId = new Map(footprint.filter(e => e.id).map(e => [e.id, e]));
  for (const entry of Array.isArray(cited) ? cited : []) {
    if (entry?.type === 'file') {
      const path = String(entry.path ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
      if (!validRelativePath(path)) { reasons.push('invalid_evidence_path'); continue; }
      const outside = /^\.(?:git|dd)\//i.test(path) || (listing && !listing.all.has(path));
      let info;
      try { info = lstatSync(join(root, path)); } catch { reasons.push(`evidence_file_missing:${path}`); continue; }
      if (outside || !info.isFile()) { reasons.push(`evidence_not_a_repository_file:${path}`); continue; }
      if (info.size > EVIDENCE_FILE_MAX) { reasons.push(`evidence_file_too_large:${path}`); continue; }
      evidence.push({ type: 'file', path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex'),
        summary: String(entry.summary ?? 'Cited when this memory was saved.').slice(0, 500) });
      files.push(path);
    } else if (entry?.type === 'observation' || entry?.type === 'correction') {
      const found = byId.get(String(entry.ref ?? ''));
      const type = found?.t === 'correction' ? 'correction' : 'observation';
      if (!found || (found.t !== 'tool' && found.t !== 'correction') || type !== entry.type) { reasons.push(`evidence_ref_unknown:${entry.ref ?? ''}`); continue; }
      evidence.push({ type, summary: String(found.preview ?? '').slice(0, 500) });
      if (type === 'correction') corrections += 1;
    } else if (entry?.type === 'note' && typeof entry.summary === 'string' && entry.summary.trim()) {
      evidence.push({ type: 'note', summary: entry.summary.slice(0, 500) });
    } else reasons.push('invalid_evidence_type');
  }
  if (!evidence.length && !reasons.length) reasons.push('evidence_required');
  return { evidence, files, corrections, reasons };
}

// Evidence proves integrity, not relevance (CLAUDE.md): a file counts toward
// auto-accept only when the memory's triggers cover it or this session touched it.
function relevantFiles(files, triggers, footprint) {
  const touched = new Set(footprint.filter(e => e.t === 'tool').flatMap(e => e.paths ?? []));
  const globs = triggers.flatMap(clause => clause.paths ?? []).map(glob => globToRegExp(glob));
  return files.filter(path => touched.has(path) || globs.some(regex => regex.test(path)));
}

// A check must flag its violating example and pass its passing one (spec section 6).
// An invalid pattern is reported by the schema; here only examples are judged.
const checkReasons = check => (check?.examples ? exampleProblems(check, createMatcher()) : []);

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
  const superseded = memory.review.issues.filter(issue => issue.startsWith('supersedes_candidate:')).map(issue => issue.split(':')[1]);
  if (superseded.length) lines.push(`It replaces the pending candidate ${superseded.join(', ')}.`);
  return lines.join('\n');
}

export async function ingestInboxFile({ root, file, sessionId, now = new Date(), compile = compileProject }) {
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
  const listing = repositoryListing(root);
  const reasons = [];
  const notDerivable = String(proposal.not_derivable ?? '').trim();
  if (notDerivable.length < NOT_DERIVABLE_MIN || [proposal.title, proposal.body].includes(notDerivable)) reasons.push('not_derivable_required');
  const { evidence, files, corrections, reasons: evidenceReasons } = resolveEvidence(root, proposal.evidence, footprint, listing);
  reasons.push(...evidenceReasons);
  let triggers = Array.isArray(proposal.triggers) ? proposal.triggers : [];
  let suggested = false;
  let hint = null;
  if (!triggers.length) {
    // Only the fix the proposal cites lends its triggers: a save about something
    // else gets the last fix's suggestions to adopt, not silently.
    const cited = new Set((Array.isArray(proposal.evidence) ? proposal.evidence : []).map(entry => String(entry?.ref ?? '')));
    const fixes = findEvidence(footprint, { includeAsked: true }).fixes;
    const fix = fixes.findLast(f => [...f.failures, f.validation].some(e => cited.has(e.id)));
    triggers = fix ? suggestTriggers(fix) : [];
    suggested = triggers.length > 0;
    if (!suggested) {
      reasons.push('triggers_required');
      const last = fixes.at(-1) ? suggestTriggers(fixes.at(-1)) : [];
      if (last.length) hint = `Suggested from this session's last fix: ${JSON.stringify(last)}`;
    }
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
  if (typeof memory.body === 'string') {
    const known = listing ? codeSymbols(root, namedSymbols(memory)) : null;
    reasons.push(...genericReasons(memory, { repoFiles: listing ? [...listing.all] : null, symbolExists: known ? name => known.has(name) : null }));
  }
  reasons.push(...checkReasons(memory.check));
  const repoFiles = reasons.length ? null : listing?.tracked ?? null;
  const found = repoFiles ? codeSymbols(root, [...new Set(triggers.flatMap(clause => clause.symbols ?? []))]) : null;
  const warnings = repoFiles ? triggerWarnings(memory, repoFiles, found ? symbol => found.has(symbol) : null) : [];
  for (const warning of warnings) if (warning.kind.startsWith('dead_')) reasons.push(`${warning.kind}:${warning.value}`);
  if (reasons.length) return reject(name, reasons, hint);

  const duplicate = duplicateOf(memory, live);
  const verified = { files: relevantFiles(files, triggers, footprint).length, corrections };
  const accept = autoAcceptReasons({ memory, verified, warnings, duplicateOf: duplicate, enabled: autoAcceptEnabled(config),
    triggersVerified: Boolean(repoFiles && found) });
  // A rewrite replaces the candidates still pending on its topic, in the same commit.
  const pending = all.filter(other => other.status === 'candidate' && other.topic === memory.topic);
  const stored = { ...memory, status: accept.length ? 'candidate' : 'active',
    review: { migrated: false, issues: [...(duplicate ? [`suspected_duplicate:${duplicate}`] : []), ...pending.map(other => `supersedes_candidate:${other.id}`)] } };
  await store.commit({ put: [stored], remove: pending.map(other => other.id) });
  // Stored: the file goes now, so writing it again never revises what it just became.
  rmSync(file, { force: true });
  let reply = storedReply(stored, { suggested, warnings, accept });
  try { await compile(root); } catch { reply += '\nThe index could not be rebuilt now; the index is rebuilt at the next session start.'; }
  return { reply, stored };
}
