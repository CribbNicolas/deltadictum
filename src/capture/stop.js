import { appendFootprint, findEvidence, footprintPath, readFootprint, suggestTriggers } from './footprint.js';

const CLIP = 160;
const clip = text => (String(text).length > CLIP ? `${String(text).slice(0, CLIP - 1)}…` : String(text));

// The capture request (spec section 7): only after a turn that fixed a failure or
// took a user correction, once per evidence set, about 300 tokens.
export function stopRequest(root, payload, { now = new Date() } = {}) {
  if (payload.stop_hook_active) return '';
  const path = footprintPath(root, payload.session_id);
  if (!path) return '';
  const { fixes, corrections } = findEvidence(readFootprint(path));
  const fix = fixes.at(-1);
  if (!fix && !corrections.length) return '';
  const all = [...fixes.flatMap(f => [...f.failures, f.validation]), ...corrections];
  appendFootprint(path, { t: 'asked', at: now.toISOString(), ids: all.map(e => e.id) });
  const cited = [...(fix ? [...fix.failures.slice(-2), fix.validation] : []), ...corrections.slice(-2)];
  const what = [fix ? 'fixed a failure' : null, corrections.length ? 'received a user correction' : null].filter(Boolean).join(' and ');
  const lines = [
    `DD - This turn ${what}. If it taught something an agent reading the code, tests and docs would not work out, save it; otherwise do nothing.`,
    'Write one JSON file per memory to .dd/inbox/<name>.json: topic (area/subject), kind (trap, decision, fact, failed_approach or procedure), title, body (what to do and why, at most 1,500 characters), not_derivable (why the code would not reveal it), triggers and evidence. DD replies in the same turn.',
    'Evidence: {"type":"file","path":"<repository file>"} or one of these:',
    ...cited.map(e => `- {"type":"${e.t === 'correction' ? 'correction' : 'observation'}","ref":"${e.id}"} ${clip(e.preview ?? '')}`),
  ];
  const triggers = fix ? suggestTriggers(fix) : [];
  if (triggers.length) lines.push(`Suggested triggers, used when you give none: ${JSON.stringify(triggers)}`);
  return lines.join('\n');
}
