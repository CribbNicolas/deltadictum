import { redactSecrets, sanitizeText } from '../engine/v2/sanitizer.js';

// One redaction treatment for every observation. A user prompt is more likely to
// carry a pasted credential than a tool's stderr, so the prompt path reuses this
// rather than relaxing it.
function redact(raw, limit) {
  return redactSecrets(sanitizeText(String(raw))).slice(0, limit);
}

// Claude Code reports an outcome through the event rather than an exit code
// (shapes recorded from a real session, 2026-09-24): a successful Bash call fires
// PostToolUse with {stdout, stderr, interrupted} and no exit code, and a failed
// call fires PostToolUseFailure with an `error` string instead. That meaning is
// read only when the caller knows the host is Claude Code (L4): another host
// sending an event of the same name is not assumed to share it.
export function observationFromTool(payload, { claudeCode = false } = {}) {
  const tool = String(payload.tool_name ?? payload.toolName ?? '');
  if (/(^|__)(dd|deltadictum)(__|_)/i.test(tool)) return null;
  const response = payload.tool_response ?? payload.toolResponse ?? payload.result ?? {};
  const event = claudeCode ? payload.hook_event_name : undefined;
  const exit = response.exit_code ?? response.exitCode ?? payload.exit_code;
  const failed = event === 'PostToolUseFailure' || payload.is_error === true || response.is_error === true || response.isError === true
    || (typeof exit === 'number' && exit !== 0);
  const succeeded = typeof exit === 'number' ? exit === 0 : event === 'PostToolUse' && response.interrupted === false;
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const command = typeof input === 'string' ? input : input.command ?? input.cmd ?? '';
  const validation = !failed && succeeded && /\b(test|pytest|jest|vitest|lint|typecheck|tsc|check)\b/i.test(command);
  if (!failed && !validation) return null;
  const raw = event === 'PostToolUseFailure' ? payload.error ?? ''
    : typeof response === 'string' ? response : response.stderr || response.output || response.stdout || response.error || '';
  // Keep a small diagnostic and a verified host exit signal, not the tool input
  // or full logs. Secret-like assignments and common tokens are redacted.
  const preview = redact(raw, 600);
  const signal = typeof exit === 'number' || !event ? `exit ${exit ?? 'unknown'}` : event;
  return { source_type: failed ? 'tool_failure' : 'validation', source_ref: tool,
    raw_preview: `${failed ? 'Failed' : 'Validation passed'} (${signal}). ${preview}`,
    metadata: { provenance: 'host', tool, exit_code: exit ?? null, signal: failed ? 'failure' : 'validation',
      session_id: String(payload.session_id ?? payload.sessionId ?? '').slice(0, 150) } };
}

// Corrective language, English and Spanish, following the lexical precedent in
// src/engine/v2/admission.js rather than inventing a second style. It is a
// regex and nothing else because PreToolUse-class hooks are ephemeral Node
// processes with two dependencies (L1, L3): there is no model to call and
// nothing to learn a classifier from (L6).
//
// Each family demands a corrective marker rather than a bare keyword, because a
// bare keyword matches ordinary work: "don't forget the docs" and "stop the
// server after the test" are instructions, not corrections. The asymmetry that
// shapes the families is that a false positive costs one reviewable observation
// that promotes nothing, while a false negative loses the highest-reliability
// signal DD ever sees, silently.
const CORRECTION = new RegExp([
  // A leading refusal. In a reply, it is always about what just happened.
  String.raw`^\s*(?:no|nope|nah)\s*[,.;:!?—-]`,
  // A verdict on what was just done.
  String.raw`\b(?:that'?s?|this|it)\s+(?:is\s+)?(?:not\s+(?:right|correct|what)|wrong|incorrect|backwards)\b`,
  String.raw`\bnot\s+what\s+i\s+(?:asked|said|wanted|meant)\b`,
  String.raw`\byou\s+(?:broke|misunderstood|misread|ignored|skipped|were\s+wrong|got\s+it\s+wrong|did\s*n[o']?t|should\s*n[o']?t\s+have)\b`,
  String.raw`\bi\s+(?:told|said|asked)\s+you\b`,
  // An instruction to take it back.
  String.raw`\b(?:revert|undo|roll\s*back|back\s+that\s+out)\b`,
  // A substitution for what was done.
  String.raw`\binstead\s+of\b|\buse\s+.{1,40}\s+instead\b`,
  // A negated imperative aimed at an action already under way.
  String.raw`\b(?:do\s*n[o']?t|never)\s+(?:do|use|change|touch|add|remove|edit|modify|create|commit|delete|rewrite)\b`,
  String.raw`\bstop\s+(?:doing|changing|editing|adding|using|that)\b`,
  String.raw`\bwrong\s+(?:file|place|one|approach|direction|branch|function|method)\b`,
  // Spanish: verdict, retraction, substitution, negated imperative.
  String.raw`\b(?:est[aá]s?\s+mal|mal\s+hecho|no\s+es\s+correcto|est[aá]\s+equivocad[oa]|te\s+equivocaste)\b`,
  String.raw`\beso\s+no\s+(?:es|era)\b|\bno\s+es\s+lo\s+que\b`,
  String.raw`\bte\s+(?:dije|ped[ií])\b`,
  String.raw`\b(?:revierte|revi[eé]rtelo|revertir|deshaz|deshacer|vuelve\s+atr[aá]s)\b`,
  String.raw`\ben\s+su\s+lugar\b|\bmejor\s+us[ae]\b`,
  String.raw`\bno\s+(?:uses|cambies|toques|agregues|a[ñn]adas|edites|modifiques|crees|borres|elimines|hagas|hiciste)\b`,
  String.raw`\b(?:archivo|lugar|enfoque|funci[oó]n|rama)\s+equivocad[oa]\b`,
].join('|'), 'i');

// A user correction is the most reliable input DD can receive, and until now the
// only thing that recorded it was the model remembering to propose it. This
// records that a correction happened and what was said. It deliberately does not
// infer what the correction was *about*: that needs conversation history the
// hook does not have and a model it cannot call. Connecting it to a behaviour is
// the model's job at proposal time.
export function observationFromPrompt(payload) {
  // Bound the input before any work runs. This is UserPromptSubmit, once per
  // prompt, so the cost must stay proportional to a prompt rather than to a
  // paste. Detection reads more than is kept, because a correction buried after
  // a pasted log is still a correction.
  const raw = String(payload.prompt || payload.text || payload.user_prompt || '').slice(0, 4000);
  const text = redact(raw, 4000);
  if (!text || !CORRECTION.test(text)) return null;
  return { source_type: 'user_correction', source_ref: 'UserPromptSubmit',
    raw_preview: `User correction. ${text.slice(0, 600)}`,
    // The provenance only names the source. What ceiling it earns is the
    // reliability ladder's decision, made at admission, not here.
    metadata: { provenance: 'user_correction', signal: 'correction',
      session_id: String(payload.session_id ?? payload.sessionId ?? '').slice(0, 150) } };
}

// L5: the prompt hook owes the turn its retrieval context. Recording a
// correction is worth less than the turn it was observed in, so a failure here
// is silence, never a degraded prompt.
export async function recordPromptObservation(payload, { store, projectId }) {
  try {
    const observation = observationFromPrompt(payload);
    if (observation) await store.putObservation({ ...observation, project_id: projectId });
  } catch { /* observation is best-effort; the context is not */ }
}
