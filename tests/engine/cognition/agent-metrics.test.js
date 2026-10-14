import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboveBest, limitWait, meanCi, qualityScore, parseNumstat, redact, median, percent, streamMetrics, taskReport, usageLimited, wilson } from '../../../src/eval/agent/metrics.js';

const toolUse = (...names) => JSON.stringify({ type: 'assistant', message: { content: names.map((name, i) => ({ type: 'tool_use', id: `t${i}`, name, input: {} })) } });

test('stream metrics count tool calls, exploration and DD tool calls', () => {
  const stream = [toolUse('Read', 'Grep'), '{"type":"rate_limit_event"}', 'not json', toolUse('Edit', 'mcp__dd__retrieve', 'Glob'),
    JSON.stringify({ type: 'result', subtype: 'success' })].join('\n');
  const m = streamMetrics(stream, null);
  assert.equal(m.tool_calls, 5);
  assert.equal(m.exploration_calls, 3);
  assert.equal(m.dd_tool_calls, 1);
  assert.equal(m.key_memory, null);
});

const KEY = '19a1686f-66d6-4d5f-88f9-cfe3b46d6f1b';
const OTHER = 'a9fe1f6b-036d-4a63-9805-2462ed5dc6a4';
const hook = (event, context) => JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: event,
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) });
const toolCall = (id, name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, text) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });

test('stream metrics read what DD injected and whether session start found DD active', () => {
  const stream = [hook('SessionStart', 'DD - loaded for `p` (2 active).\nDD - Memory map (2):\ndd/x — when y'),
    hook('PreToolUse', `DD - Project knowledge (advisory):\n[LESSON ${OTHER}] Close stores.\n[DECISION ${OTHER}] again`),
    JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse', stdout: '' })].join('\n');
  const m = streamMetrics(stream, null);
  assert.equal(m.dd_inactive, false);
  assert.equal(m.memories_pushed, 1);
  assert.ok(m.injected_tokens > 20);
  assert.equal(streamMetrics(hook('SessionStart', 'DD - Inactive: the resident DD process is loading'), null).dd_inactive, true);
});

// v2 names a delivered memory by its title; the list tells the key memory from the noise.
test('v2 deliveries are listed by title, once each, so the key memory and the noise can be told apart', () => {
  const stream = [hook('PreToolUse', 'DD - project knowledge (src/a.js):\n[TRAP] Close stores - Close them in t.after.\n[DECISION] Keep CJS - Because it is faster.'),
    hook('UserPromptSubmit', 'DD - project knowledge (prompt):\n[FACT] Codex shapes - Recorded from sessions.\n... and 1 more: Other rule'),
    hook('PreToolUse', 'DD - project knowledge (src/b.js):\n[TRAP] Close stores - Close them in t.after.')].join('\n');
  const m = streamMetrics(stream, { id: 'x', title: 'Close stores' });
  assert.deepEqual(m.delivered_titles, ['Close stores', 'Keep CJS', 'Codex shapes']);
  assert.equal(m.memories_pushed, 3);
  assert.equal(m.key_memory.pushed, true);
});

test('the key memory counts as pushed, pointed or pulled by how it reached the agent', () => {
  const pushed = streamMetrics(hook('PreToolUse', `[LESSON ${KEY}] [anchor: threshold] Use a reachable ceiling.`), KEY);
  assert.deepEqual(pushed.key_memory, { pushed: true, pointed: false, pulled: false });
  const pointed = streamMetrics(hook('PreToolUse', `DD - Possibly relevant, not pushed:\n- dd/engine/x — when (get ${KEY.slice(0, 8)})`), KEY);
  assert.deepEqual(pointed.key_memory, { pushed: false, pointed: true, pulled: false });
  const pulledById = streamMetrics([toolCall('t1', 'mcp__dd__get', { id: KEY.slice(0, 8) })].join('\n'), KEY);
  assert.equal(pulledById.key_memory.pulled, true);
  const retrieved = streamMetrics([toolCall('t2', 'mcp__dd__retrieve', { action: 'set threshold' }),
    toolResult('t2', JSON.stringify({ memories: [{ id: KEY, content: 'Use a reachable ceiling.' }] }))].join('\n'), KEY);
  assert.equal(retrieved.key_memory.pulled, true);
  const missed = streamMetrics([toolResult('t3', `unrelated ${KEY}`), hook('SessionStart', `map mentions ${KEY.slice(0, 8)}`)].join('\n'), KEY);
  assert.deepEqual(missed.key_memory, { pushed: false, pointed: false, pulled: false });
});

const text = t => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });

const turn = (id, usage, content = []) => JSON.stringify({ type: 'assistant', message: { id, usage, content } });

test('peak context is the largest prompt one turn sent, counted once per message', () => {
  const stream = [
    turn('m1', { input_tokens: 5, cache_creation_input_tokens: 20000, cache_read_input_tokens: 0 }),
    turn('m2', { input_tokens: 2, cache_creation_input_tokens: 1500, cache_read_input_tokens: 20000 }),
    // The same message again (one event per content block) is not a new turn.
    turn('m2', { input_tokens: 2, cache_creation_input_tokens: 1500, cache_read_input_tokens: 20000 }),
    turn('m3', { input_tokens: 1, cache_creation_input_tokens: 300, cache_read_input_tokens: 21000 }),
  ].join('\n');
  assert.equal(streamMetrics(stream, null).peak_context_tokens, 21502);
  assert.equal(streamMetrics('', null).peak_context_tokens, 0);
});

test('the session time and whether the session finished come from its result event', () => {
  const finished = streamMetrics([toolUse('Read'), JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 929603, num_turns: 16 })].join('\n'), null);
  assert.equal(finished.session_ms, 929603);
  assert.equal(finished.finished, true);
  // Killed before its result: the session never finished and has no time of its own.
  const killed = streamMetrics(toolUse('Read'), null);
  assert.equal(killed.session_ms, null);
  assert.equal(killed.finished, false);
});

test('guide reads count the tool calls that open or search the engineering guide', () => {
  const stream = [toolCall('t1', 'Read', { file_path: 'C:\\x\\docs\\engineering-guide.md', offset: 1, limit: 300 }),
    toolCall('t2', 'Grep', { pattern: 'threshold', path: 'docs/engineering-guide.md' }),
    toolCall('t3', 'Read', { file_path: 'src/store/paths.js' })].join('\n');
  assert.equal(streamMetrics(stream, null).guide_reads, 2);
});

test('the task report is what the agent said before a Stop hook asked for more', () => {
  const stream = [text('Let me look.'), toolCall('t1', 'Read', {}), text('Set the default to 0.85;'), text('0.8 is unreachable.'),
    hook('Stop', 'DD - If this turn taught something reusable, propose it.'), text("I'm not proposing a memory."),
    JSON.stringify({ type: 'result', result: "I'm not proposing a memory." })].join('\n');
  assert.equal(taskReport(stream), 'Set the default to 0.85;\n\n0.8 is unreachable.');
  // Without a Stop continuation, the last words after the last tool call.
  assert.equal(taskReport([toolCall('t1', 'Edit', {}), text('Done.')].join('\n')), 'Done.');
  assert.equal(taskReport(''), null);
});

test('numstat counts files and lines, and counts a binary file without lines', () => {
  const stat = parseNumstat('3\t1\tsrc/engine/budget.js\n10\t0\ttests/engine/budget.test.js\n-\t-\tdocs/assets/a.gif\n');
  assert.deepEqual(stat, { files: 3, added: 13, removed: 1, lines: 14 });
  assert.deepEqual(parseNumstat(''), { files: 0, added: 0, removed: 0, lines: 0 });
});

test('redaction removes what reveals DD to a blind judge and keeps the engineering content', () => {
  const answer = [
    'Per the retrieved memory 19a1686f-66d6-4d5f-88f9-cfe3b46d6f1b, 0.8 sits in a dead zone.',
    'DD - Project knowledge (advisory): [LESSON 19a1686f] use a reachable ceiling.',
    'I set the default to 0.85 (get 19a1686f) in src/store/paths.js.',
  ].join('\n');
  const out = redact(answer);
  assert.doesNotMatch(out, /19a1686f/);
  assert.doesNotMatch(out, /retrieved memory|DD - |\[LESSON/i);
  assert.match(out, /0\.8 sits in a dead zone/);
  assert.match(out, /I set the default to 0\.85 +in src\/store\/paths\.js/);
});

// DD v2 delivers "[KIND] title - body" lines without ids; its key memory is found by title.
test('stream metrics count v2 deliveries and find the key memory by its title', () => {
  const stream = [
    hook('PreToolUse', 'DD - project knowledge (src/store/paths.js):\n[TRAP] Reachable ceilings - Use a reachable ceiling.\n[ABANDONED] Old cache - It went stale.'),
    hook('PreToolUse', 'DD - project knowledge (src/a.js):\n[DECISION] [DISPUTED] Ports - Use 7733.'),
  ].join('\n');
  const metrics = streamMetrics(stream, { id: KEY, title: 'Reachable ceilings' });
  assert.equal(metrics.memories_pushed, 3);
  assert.equal(metrics.key_memory.pushed, true);
  assert.equal(streamMetrics(stream, { id: KEY, title: 'Something else' }).key_memory.pushed, false);
});

test('redaction removes v2 delivery lines too', () => {
  const out = redact('I kept the ceiling reachable.\n[TRAP] Reachable ceilings - Use a reachable ceiling.\n[FACT] Ports - 7733.\nDone in src/store/paths.js.');
  assert.doesNotMatch(out, /\[TRAP\]|\[FACT\]|Reachable ceilings/);
  assert.match(out, /I kept the ceiling reachable\.\n+Done in src\/store\/paths\.js\./);
});

test('redaction removes what reveals the engineering guide to a blind judge', () => {
  const out = redact('As docs/engineering-guide.md says, and per the Engineering Guide, I quoted the globs in package.json.');
  assert.doesNotMatch(out, /engineering[- ]guide/i);
  assert.match(out, /I quoted the globs in package\.json\./);
});

test('redaction keeps project vocabulary that only looks like DD', () => {
  const answer = 'Updated memory_atoms and the DD_DATA directory; 2 memories pass validation.';
  assert.equal(redact(answer), answer);
});

test('the Wilson interval bounds a rate in whole percents and stays inside 0-100', () => {
  assert.deepEqual(wilson(15, 18), [61, 94]);
  assert.deepEqual(wilson(18, 18), [82, 100]);
  assert.deepEqual(wilson(0, 10), [0, 28]);
  assert.equal(wilson(0, 0), null);
});

test('a usage limit is recognised from the result event or its message', () => {
  assert.equal(usageLimited({ api_error: 'usage_limit_reached', result: 'x' }), true);
  assert.equal(usageLimited({ result: "You've hit your session limit · resets 6:30pm (America/Argentina/Buenos_Aires)" }), true);
  assert.equal(usageLimited("You've hit your session limit · resets 6:30pm"), true);
  assert.equal(usageLimited({ result: 'Fixed the reindex; tests pass.' }), false);
  assert.equal(usageLimited(null), false);
});

test('the wait for a usage limit runs to the stated reset, the next day when it has passed', () => {
  const now = new Date(2026, 9, 7, 15, 10);
  const minutes = ms => Math.round(ms / 60000);
  // 15:10 to 18:30, plus two minutes of margin.
  assert.equal(minutes(limitWait("You've hit your session limit · resets 6:30pm (America/Argentina/Buenos_Aires)", now)), 202);
  assert.equal(minutes(limitWait('resets 9am', now)), (24 - 15) * 60 - 10 + 9 * 60 + 2);
  assert.equal(minutes(limitWait('resets 12pm', new Date(2026, 9, 7, 11, 0))), 62);
  // No time it can read: check again in half an hour.
  assert.equal(minutes(limitWait('usage limit reached', now)), 30);
});

test('a run scores the requirements it met among those that apply', () => {
  assert.equal(qualityScore({ ui_hint: true, tested: false, scoped: true, conventions: true }), 0.75);
  assert.equal(qualityScore({ store_closed_in_after: null, tested: true, scoped: false }), 0.5);
  assert.equal(qualityScore({ store_closed_in_after: null }), null);
  assert.equal(qualityScore({}), null);
});

test('above-best puts the lowest value at 0 and the rest as a percent over it', () => {
  assert.deepEqual(aboveBest({ dd: 0.12, doc: 0.15, docref: 0.18 }), { dd: 0, doc: 25, docref: 50 });
  assert.deepEqual(aboveBest({ dd: 30000, doc: null, docref: 24000 }), { dd: 25, doc: null, docref: 0 });
});

test('the mean of per-run scores comes with a 95% interval in percents', () => {
  const { mean, ci95 } = meanCi([1, 1, 0.5, 0.75, 1, 0.5]);
  assert.equal(mean, 79);
  assert.deepEqual(ci95, [59, 99]);
  assert.deepEqual(meanCi([1, 1, 1]), { mean: 100, ci95: [100, 100] });
  assert.deepEqual(meanCi([]), { mean: null, ci95: null });
});

test('median takes the lower middle and percent rounds to whole numbers', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(percent(15, 18), 83);
  assert.equal(percent(1, 0), null);
});
