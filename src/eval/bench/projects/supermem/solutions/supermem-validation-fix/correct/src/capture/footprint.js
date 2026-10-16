import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ledgerPath } from '../engine/ledger.cjs';
import { localPaths } from '../engine/locate.cjs';
import { containsSecret, redactSecrets, sanitizeText } from '../engine/v2/sanitizer.js';
import { toolEvent } from '../hooks/v2/events.cjs';
import { observationFromPrompt, observationFromTool, runsValidation } from '../hooks/observe.js';

// A session's footprint (spec section 7): what the agent touched and ran, and
// what failed, passed or was corrected. Paths, redacted commands, identifiers and
// short redacted previews, never file contents. Its own file beside the delivery
// ledger, which every tool call reads and which must stay small.
export function footprintPath(root, sessionId) {
  const ledger = ledgerPath(localPaths(root).sessions, sessionId);
  return ledger ? ledger.replace(/\.jsonl$/, '.footprint.jsonl') : null;
}

const newId = () => `e${randomBytes(4).toString('hex')}`;
const IDENTIFIER = /[A-Za-z_$][\w$]{3,}/g;
const MAX_IDENTIFIERS = 40;
const TEXT_MAX = 300;
const IDENTIFIER_MAX = 64;
// A value assigned to a key that names a credential (DB_PASSWORD=..., "apiToken": ...).
const SECRET_VALUE = /([\w.-]*(?:pass(?:wd|word)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)[\w.-]*["']?\s*[=:]\s*)["']?[^\s"',;]+["']?/gi;
// Names from written content, never the secrets in it: credentials in their
// issuers' shapes and values assigned to credential-named keys are removed first.
function identifiersOf(text) {
  const safe = redactSecrets(String(text ?? '')).replace(SECRET_VALUE, '$1[redacted]');
  return [...new Set(safe.match(IDENTIFIER) ?? [])].filter(id => id.length <= IDENTIFIER_MAX && !containsSecret(id)).slice(0, MAX_IDENTIFIERS);
}
const clean = text => redactSecrets(sanitizeText(text)).slice(0, TEXT_MAX);

// When this hook process started: post-tool hooks are async, so a slower one may
// append after the next tool's hook, but each starts in the order of its tool.
const hookStarted = () => new Date(performance.timeOrigin);

export function toolEntry(payload, { root, claudeCode = false, now = hookStarted() } = {}) {
  const tool = String(payload.tool_name ?? '');
  const event = toolEvent(tool, payload.tool_input ?? {}, root, payload.cwd || root);
  if (!event) return null;
  const entry = { t: 'tool', id: newId(), at: now.toISOString(), tool, kind: event.kind, paths: event.paths.filter(Boolean).slice(0, 12) };
  if (event.kind === 'run') {
    entry.command = clean(event.text);
    if (runsValidation(event.text)) entry.runner = true;
  }
  if (event.kind === 'search') entry.pattern = clean(event.text);
  if (event.kind === 'edit' || event.kind === 'write') entry.identifiers = identifiersOf(event.text);
  const observation = observationFromTool(payload, { claudeCode });
  if (observation) {
    entry.outcome = observation.metadata.signal === 'failure' ? 'failure' : 'validation';
    entry.preview = observation.raw_preview.slice(0, TEXT_MAX);
    entry.output_identifiers = identifiersOf(observation.raw_preview);
  }
  return entry;
}

export function correctionEntry(payload, { now = hookStarted() } = {}) {
  const observation = observationFromPrompt(payload);
  return observation ? { t: 'correction', id: newId(), at: now.toISOString(), preview: observation.raw_preview.slice(0, TEXT_MAX) } : null;
}

export function appendFootprint(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readFootprint(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const entries = text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  // Stable: entries with the same start time, or none, keep their file order.
  return entries.map((entry, i) => [entry, i]).sort(([a, i], [b, j]) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || i - j).map(([entry]) => entry);
}

const isRepoPath = path => Boolean(path) && path !== '.' && !path.startsWith('.dd/') && !path.startsWith('../') && !path.startsWith('/') && !/^[A-Za-z]:/.test(path);
const changesRepo = entry => (entry.kind === 'edit' || entry.kind === 'write') && entry.paths.some(isRepoPath);

// What a turn can teach (spec section 7): a fix (failures, then edits, then a
// passing validation) and user corrections. Evidence already asked about is left
// out, so each set is asked about once.
export function findEvidence(entries, { includeAsked = false } = {}) {
  const asked = includeAsked ? new Set() : new Set(entries.filter(e => e.t === 'asked').flatMap(e => e.ids ?? []));
  const fixes = [];
  let failures = [];
  let edits = [];
  for (const entry of entries) {
    if (entry.t !== 'tool') continue;
    // A fix starts at a failing test, lint or type-check run; a failed Edit, a
    // missing file or a grep that found nothing is routine, not a failure to fix.
    if (entry.outcome === 'failure') { if (entry.kind === 'run' && entry.runner) failures.push(entry); continue; }
    if (failures.length && changesRepo(entry)) edits.push(entry);
    if (entry.outcome === 'validation') {
      if (failures.length && edits.length && !asked.has(entry.id)) fixes.push({ failures, edits, validation: entry });
      failures = [];
      edits = [];
    }
  }
  return { fixes, corrections: entries.filter(e => e.t === 'correction' && !asked.has(e.id)) };
}

// Sibling files of one folder and extension, three or more, become one glob.
function collapse(paths) {
  const groups = new Map();
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    const key = `${path.slice(0, slash + 1)}\0${dot > slash ? path.slice(dot) : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups].flatMap(([key, members]) => {
    const [dir, ext] = key.split('\0');
    return members.length >= 3 && ext ? [`${dir}*${ext}`] : members;
  });
}

// A command's program and subcommand, without its arguments: `npm test`, `node --test`.
function commandPrefix(command) {
  const first = String(command).split(/&&|\|\||;|\|/)[0].trim().split(/\s+/).filter(token => !/^\w+=/.test(token));
  const out = [];
  for (const token of first) {
    if (token === '--' || out.length >= 3 || (out.length && (token.includes('/') || token.includes('\\') || /\.\w+$/.test(token)))) break;
    out.push(token);
  }
  return out.join(' ');
}

const COMMON = new Set(['function', 'return', 'const', 'string', 'number', 'object', 'undefined', 'expected', 'actual', 'error',
  'typeerror', 'referenceerror', 'syntaxerror', 'assertionerror', 'node_modules', 'require', 'import', 'export', 'default']);
// An identifier specific enough to trigger on: camelCase, snake_case, or long.
const distinctive = id => !COMMON.has(id.toLowerCase()) && (/[a-z][A-Z]/.test(id) || id.includes('_') || id.length >= 10);

export function suggestTriggers(fix) {
  const clauses = [];
  const paths = collapse([...new Set(fix.edits.flatMap(e => e.paths).filter(isRepoPath))]).slice(0, 12);
  if (paths.length) clauses.push({ on: ['edit'], paths });
  const commands = [...new Set(fix.failures.filter(e => e.kind === 'run' && e.command).map(e => commandPrefix(e.command)).filter(Boolean))].slice(0, 4);
  if (commands.length) clauses.push({ on: ['run'], commands });
  const output = new Set(fix.failures.flatMap(e => e.output_identifiers ?? []));
  const symbols = [...new Set(fix.edits.flatMap(e => e.identifiers ?? []))].filter(id => output.has(id) && distinctive(id)).slice(0, 12);
  if (symbols.length) clauses.push({ on: ['edit', 'write'], symbols });
  return clauses;
}
