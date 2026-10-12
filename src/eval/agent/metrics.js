// Pure helpers for the agent trial: what run.js recorded, turned into numbers.
// No model calls and no file access here, so all of it is unit-tested.
// About three bytes a token, as v1 measured injected context.
const estimateTokens = value => Math.max(1, Math.ceil(Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8') / 3));

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}

export const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

// 95% Wilson score interval for k successes in n, in whole percents. It stays
// meaningful at 0/n and n/n, where the normal approximation collapses to a point.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, Math.round((center - half) * 100)), Math.min(100, Math.round((center + half) * 100))];
}

// The share of a run's requirements it met, among those that apply (null: not applicable).
export function qualityScore(requirements) {
  const decided = Object.values(requirements ?? {}).filter(value => typeof value === 'boolean');
  return decided.length ? decided.filter(Boolean).length / decided.length : null;
}

// Each value as a percent over the lowest one, which reads 0: the scale the
// trial reports context, time and cost on.
export function aboveBest(values) {
  const known = Object.values(values).filter(v => typeof v === 'number');
  const best = Math.min(...known);
  return Object.fromEntries(Object.entries(values).map(([key, v]) =>
    [key, typeof v === 'number' && best > 0 ? Math.round(((v - best) / best) * 100) : null]));
}

// Mean of per-run scores in 0..1 with a normal-approximation 95% interval, in whole percents.
export function meanCi(values, z = 1.96) {
  if (!values.length) return { mean: null, ci95: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((n, v) => n + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
  const half = z * sd / Math.sqrt(values.length);
  const pct = v => Math.round(Math.min(1, Math.max(0, v)) * 100);
  return { mean: pct(mean), ci95: [pct(mean - half), pct(mean + half)] };
}

// git diff --numstat: "added<TAB>removed<TAB>path", with "-" for a binary file.
export function parseNumstat(text) {
  const stat = { files: 0, added: 0, removed: 0, lines: 0 };
  for (const line of String(text ?? '').split('\n')) {
    const [added, removed, path] = line.split('\t');
    if (!path) continue;
    stat.files += 1;
    stat.added += Number(added) || 0;
    stat.removed += Number(removed) || 0;
  }
  stat.lines = stat.added + stat.removed;
  return stat;
}

// What would tell a judge which change had DD: the delivery lines DD's hooks
// write, memory ids, pointers and phrases naming a recalled memory. Project
// vocabulary (memory_atoms, DD_DATA) stays: this repository is DD itself.
const DELIVERY_LINE = /^.*(?:DD - |\[(?:LESSON|DECISION|CLAIM|PROCEDURE|ANTI)\b).*$/gm;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const POINTER = /\(get [0-9a-f]{6,}\)/gi;
const RECALL = /\b(?:the |a |this |that )?(?:retrieved|recalled|pushed|injected|stored|project|dd)\s+(?:memory|memories|lesson|lessons|knowledge)\b/gi;
const SHORT_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/gi;
// The documentation conditions' guide, named by path or by title.
const GUIDE = /(?:(?:as |per |in )?(?:the )?)?(?:docs\/)?engineering[- ]guide(?:\.md)?(?: says)?,?/gi;

export function redact(text) {
  return String(text ?? '').replace(DELIVERY_LINE, '').replace(UUID, '').replace(POINTER, '')
    .replace(RECALL, '').replace(SHORT_ID, '').replace(GUIDE, '').replace(/\n{3,}/g, '\n\n').trim();
}

const EXPLORATION = new Set(['Read', 'Grep', 'Glob']);
function events(stream) {
  return String(stream ?? '').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

// The context each hook added, from --include-hook-events.
function hookContexts(all) {
  return all.filter(e => e.type === 'system' && e.subtype === 'hook_response').map(e => {
    let text = '';
    try { text = JSON.parse(e.stdout || '{}').hookSpecificOutput?.additionalContext ?? ''; } catch { /* not JSON: nothing added */ }
    return { event: e.hook_event, text };
  }).filter(c => c.text);
}

const PUSHED = /\[(?:LESSON|DECISION|CLAIM|PROCEDURE|ANTI)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;
const resultText = r => (typeof r.content === 'string' ? r.content : (r.content ?? []).map(part => part.text ?? '').join(''));

// What the agent did and what DD gave it, from its stream-json events
// (claude -p --verbose --include-hook-events). memoryId: the task's key memory.
export function streamMetrics(stream, memoryId) {
  const all = events(stream);
  const calls = all.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(c => c.type === 'tool_use');
  const results = all.filter(e => e.type === 'user').flatMap(e => e.message?.content ?? []).filter(c => c.type === 'tool_result');
  const contexts = hookContexts(all);
  const pushed = new Set(contexts.flatMap(c => [...c.text.matchAll(PUSHED)].map(m => m[1])));
  const ddCalls = new Set(calls.filter(c => c.name.startsWith('mcp__dd__')).map(c => c.id));
  const short = memoryId?.slice(0, 8);
  // One event per content block repeats a message's usage: count each message once.
  const prompts = new Map(all.filter(e => e.type === 'assistant' && e.message?.usage).map(e => {
    const u = e.message.usage;
    return [e.message.id, (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)];
  }));
  const result = all.find(e => e.type === 'result');
  return {
    // A session that reached its result finished, even if its process then
    // lingered past the deadline (a child it left running holding it open).
    finished: Boolean(result),
    session_ms: typeof result?.duration_ms === 'number' ? result.duration_ms : null,
    tool_calls: calls.length,
    // The context window at its fullest: the largest prompt any turn sent.
    peak_context_tokens: Math.max(0, ...prompts.values()),
    guide_reads: calls.filter(c => /engineering-guide/i.test(JSON.stringify(c.input ?? {}))).length,
    exploration_calls: calls.filter(c => EXPLORATION.has(c.name)).length,
    dd_tool_calls: ddCalls.size,
    dd_inactive: contexts.some(c => c.event === 'SessionStart' && c.text.includes('DD - Inactive')),
    injected_tokens: contexts.reduce((n, c) => n + estimateTokens(c.text), 0),
    memories_pushed: pushed.size,
    // Pointed: a pointer line during the work; the session-start map names every memory.
    key_memory: memoryId ? {
      pushed: pushed.has(memoryId),
      pointed: contexts.some(c => c.event !== 'SessionStart' && c.text.includes(`(get ${short})`)),
      pulled: calls.some(c => c.name === 'mcp__dd__get' && String(c.input?.id ?? '').startsWith(short))
        || results.some(r => ddCalls.has(r.tool_use_id) && resultText(r).includes(memoryId)),
    } : null,
  };
}

// The agent's report on the task: its text after its last tool call, up to a Stop
// hook that adds context (DD's capture reminder), whose reply would otherwise
// become the session's final result.
export function taskReport(stream) {
  let texts = [];
  for (const e of events(stream)) {
    if (e.type === 'system' && e.subtype === 'hook_response' && e.hook_event === 'Stop' && hookContexts([e]).length) break;
    if (e.type !== 'assistant') continue;
    for (const part of e.message?.content ?? []) {
      if (part.type === 'tool_use') texts = [];
      else if (part.type === 'text' && part.text.trim()) texts.push(part.text.trim());
    }
  }
  return texts.length ? texts.join('\n\n') : null;
}

// A usage limit ends a run before or during the agent's work, which says nothing
// about the condition: the run is repeated after the reset, never recorded.
// result: a stream-json result event, or the error text a row kept.
const LIMIT = /usage_limit_reached|hit your (?:session|usage|weekly) limit/i;
export function usageLimited(result) {
  if (!result) return false;
  return result.api_error === 'usage_limit_reached' || LIMIT.test(typeof result === 'string' ? result : String(result.result ?? ''));
}

// Milliseconds until the reset the message states ("resets 6:30pm"), in local
// time, plus a margin; half an hour when it states none.
export function limitWait(text, now = new Date()) {
  const m = /resets (\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(String(text ?? ''));
  if (!m) return 30 * 60 * 1000;
  const at = new Date(now);
  at.setHours(Number(m[1]) % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0), Number(m[2] ?? 0), 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at - now + 2 * 60 * 1000;
}
