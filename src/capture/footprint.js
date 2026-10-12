import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ledgerPath } from '../engine/ledger.cjs';
import { localPaths } from '../engine/locate.cjs';
import { redactSecrets, sanitizeText } from '../engine/v2/sanitizer.js';
import { toolEvent } from '../hooks/v2/events.cjs';
import { observationFromPrompt, observationFromTool } from '../hooks/observe.js';

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
const identifiersOf = text => [...new Set(String(text ?? '').match(IDENTIFIER) ?? [])].slice(0, MAX_IDENTIFIERS);
const clean = text => redactSecrets(sanitizeText(text)).slice(0, TEXT_MAX);

export function toolEntry(payload, { root, claudeCode = false, now = new Date() } = {}) {
  const tool = String(payload.tool_name ?? '');
  const event = toolEvent(tool, payload.tool_input ?? {}, root, payload.cwd || root);
  if (!event) return null;
  const entry = { t: 'tool', id: newId(), at: now.toISOString(), tool, kind: event.kind, paths: event.paths.filter(Boolean).slice(0, 12) };
  if (event.kind === 'run') entry.command = clean(event.text);
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

export function correctionEntry(payload, { now = new Date() } = {}) {
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
  return text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
