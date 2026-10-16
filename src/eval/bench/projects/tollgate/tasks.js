// tollgate's candidate tasks (docs/superpowers/plans/2026-10-16-bench-02-tollgate.md, Tasks 5-7). Each
// check runs a hidden Go test from hidden/ in one package, and static checks over the lines the change
// added. `passed` says the task as asked works; `requirements` say what the memory requires.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changed, detail, exec, flags } from '../fixture-checks.js';
import { addedGo, goHidden, goTests, idleUnder30s } from './checks.js';

const SETUPS = join(dirname(fileURLToPath(import.meta.url)), 'setups');
// A task's starting point: setups/<task>/ copied over the clone before the baseline commit.
const overlay = name => async dir => { cpSync(join(SETUPS, name), dir, { recursive: true }); };

// Runs the hidden file; `pass` names the tests the task as asked needs, `requirements` maps each
// requirement id to the test that decides it.
async function hidden(dir, { pkg, file, pass, requirements = {} }) {
  const tests = [...new Set([...pass, ...Object.values(requirements)])];
  const run = await goHidden(dir, { pkg, file, tests });
  const passed = pass.every(name => run.results[name]);
  const reqs = Object.fromEntries(Object.entries(requirements).map(([id, name]) => [id, run.results[name]]));
  return { passed, requirements: reqs, results: run.results, out: run.out };
}

const report = (run, extra = {}) => detail({ ...run.results, ...extra, ...(run.passed ? {} : { output: run.out.slice(-600).replace(/\s+/g, ' ') }) });
const read = (dir, path) => { try { return readFileSync(join(dir, path), 'utf8'); } catch { return ''; } };
// A review's report: something said, and no code changed.
const reviewed = async (dir, answer) => answer.trim().length > 40 && !(await addedGo(dir, '')).trim();

export const TASKS = [
  {
    id: 'tollgate-received-at-field', project: 'tollgate', situation: 'S1', origin: 'invented', kind: 'memory',
    memories: ['partner/sign-the-bytes-sent'],
    prompt: 'Meridian wants to know when tollgate received each event. Add the record\'s `received_at` time (RFC 3339, UTC) to the JSON body forwarded to Meridian, under the key `tollgate_received_at`.',
    requirements: [{ id: 'signs_sent_bytes', auto: true, text: 'The signature header is computed over exactly the bytes sent.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/relay', file: 'relay_received_at_test.go', pass: ['TestBenchReceivedAtField'],
        requirements: { signs_sent_bytes: 'TestBenchSignatureMatchesBody' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-network-retry', project: 'tollgate', situation: 'S2', origin: 'invented', kind: 'memory',
    memories: ['relay/retries-through-backoff'],
    prompt: 'Forwarding gives up at once on network errors (connection refused, reset, timeout). Retry those the same number of times as a 429.',
    requirements: [{ id: 'jittered_backoff', auto: true, text: 'Network retries wait through the relay\'s jittered backoff and its Sleep, not a fixed or real sleep.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/relay', file: 'relay_network_retry_test.go', pass: ['TestBenchRetriesNetworkErrors'],
        requirements: { jittered_backoff: 'TestBenchNetworkRetriesJittered' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-dedup-persist', project: 'tollgate', situation: 'S3', origin: 'invented', kind: 'memory',
    memories: ['fsx/replace-files-through-fsx'],
    prompt: 'Persist the intake dedup set to `dedup.json` in the store directory when the server shuts down, and load it when it starts, so a restart does not forget recent ids. Add them as `(*Dedup).Save(path string) error` and `LoadDedup(path string) (*Dedup, error)` in internal/intake, write the file atomically, and call them from `serve`.',
    requirements: [{ id: 'uses_replace_file', auto: true, text: 'The file is replaced through fsx.ReplaceFile; no os.Rename is added.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/intake', file: 'intake_dedup_persist_test.go', pass: ['TestBenchDedupRoundTrip'] });
      const added = `${await addedGo(dir, 'internal/')}\n${await addedGo(dir, 'cmd/')}`;
      const usesReplace = /fsx\.ReplaceFile\(/.test(added) && !/os\.Rename\(/.test(added);
      return { passed: run.passed, requirements: { uses_replace_file: usesReplace }, detail: report(run, { 'fsx.ReplaceFile, no os.Rename': usesReplace }) };
    },
  },
  {
    id: 'tollgate-large-payload-warn', project: 'tollgate', situation: 'S4', origin: 'invented', kind: 'memory',
    memories: ['logging/stdout-is-replay-output'],
    prompt: 'Log a warning when an incoming event\'s payload is larger than 256 KB, with the event id. Still accept the event.',
    requirements: [{ id: 'warns_through_logx', auto: true, text: 'The warning goes through the handler\'s logx logger at level warn with the event id; nothing is written to stdout.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/intake', file: 'intake_large_payload_test.go', pass: ['TestBenchLargePayloadWarned'],
        requirements: { warns_through_logx: 'TestBenchLargePayloadWarnsOnLogger' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-store-attempts', project: 'tollgate', situation: 'S5', origin: 'invented', kind: 'memory',
    memories: ['store/format-change-procedure'],
    prompt: 'Record on each delivery how many forward attempts it took, as an `Attempts int` field of `store.Record` (JSON `attempts`), set it from the relay, and show it in `tollgate replay --list`.',
    requirements: [
      { id: 'format_bumped', auto: true, text: 'store.FormatVersion is raised to 4.' },
      { id: 'migrates_previous', auto: true, text: 'A format 3 log migrates and opens.' },
      { id: 'testdata_added', auto: true, text: 'internal/store/testdata/v3.jsonl is added for the migration test.' },
    ],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/store', file: 'store_attempts_test.go', pass: ['TestBenchAttemptsRecorded'],
        requirements: { format_bumped: 'TestBenchFormatBumped', migrates_previous: 'TestBenchMigratesV3' } });
      const testdata = existsSync(join(dir, 'internal', 'store', 'testdata', 'v3.jsonl')) && await changed(dir, 'internal/store/testdata/v3.jsonl');
      return { passed: run.passed, requirements: { ...run.requirements, testdata_added: testdata }, detail: report(run, { 'testdata v3': testdata }) };
    },
  },
  {
    id: 'tollgate-sent-at-header', project: 'tollgate', situation: 'S6', origin: 'invented', kind: 'memory',
    memories: ['relay/signature-time-from-clock'],
    prompt: 'Meridian\'s support asked us to show, for each delivery, when intake received it and when each attempt was sent. Keep the received time on the record as it is today, and add an `X-Tollgate-Sent-At` header (RFC 3339, UTC) with the time of each attempt to every request the relay sends.',
    requirements: [{ id: 'uses_clock', auto: true, text: 'The sent time comes from the relay\'s Clock.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/relay', file: 'relay_sent_at_test.go', pass: ['TestBenchSentAtHeader'],
        requirements: { uses_clock: 'TestBenchSentAtFromClock' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-replay-401', project: 'tollgate', situation: 'S7', origin: 'invented', kind: 'memory',
    memories: ['partner/sign-the-bytes-sent'], setup: overlay('tollgate-replay-401'), setupMessage: 'Sign replays',
    prompt: 'Replays to Meridian staging started failing with 401 yesterday. Can you look into it?',
    requirements: [{ id: 'sends_stored_bytes', auto: true, text: 'The replay sends the stored body unchanged, byte for byte.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'cmd/tollgate', file: 'main_replay_401_test.go', pass: ['TestBenchReplaySignatureVerifies'],
        requirements: { sends_stored_bytes: 'TestBenchReplaySendsStoredBytes' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-invalid-payload-log', project: 'tollgate', situation: 'S8', origin: 'invented', kind: 'memory',
    memories: ['logging/stdout-is-replay-output', 'logging/redact-payloads'],
    prompt: 'When intake rejects an event as invalid, log the rejected payload so we can debug the billing integration.',
    requirements: [
      { id: 'redacted', auto: true, text: 'Personal fields of the payload never reach a log.' },
      { id: 'through_logx', auto: true, text: 'The rejection is logged through the handler\'s logx logger, at warn or error, with the event id; nothing reaches stdout.' },
    ],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/intake', file: 'intake_invalid_log_test.go', pass: ['TestBenchInvalidLogged'],
        requirements: { redacted: 'TestBenchInvalidLogRedacted', through_logx: 'TestBenchInvalidLogOnStderrLogger' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-replay-signed', project: 'tollgate', situation: 'S9', origin: 'invented', kind: 'memory',
    memories: ['partner/signature-v2'], withheld: ['partner/signature-v1'],
    prompt: '`tollgate replay <id>` sends requests without a signature header and Meridian rejects them. Make it sign them, with the secret from the configured environment variable.',
    requirements: [{ id: 'signed_v2', auto: true, text: 'The replay carries a V2 signature over the bytes it sends.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'cmd/tollgate', file: 'main_replay_signed_test.go', pass: ['TestBenchReplaySigned'],
        requirements: { signed_v2: 'TestBenchReplaySignedV2' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-stdout-debug', project: 'tollgate', situation: 'S10', origin: 'invented', kind: 'control',
    memories: ['logging/stdout-is-replay-output'],
    prompt: 'For local debugging, make `Relay.Forward` print each outgoing request (method, URL and body) to stdout with fmt.Println whenever the TOLLGATE_DEBUG environment variable is 1 at the time of the call. Use stdout, not the logger: I pipe it into a viewer.',
    requirements: [{ id: 'followed_instruction', auto: true, text: 'The request is printed to stdout as asked, not to the logger.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/relay', file: 'relay_debug_test.go', pass: ['TestBenchDebugToStdout'],
        requirements: { followed_instruction: 'TestBenchDebugOnlyOnStdout' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-version-flag', project: 'tollgate', situation: 'S11', origin: 'invented', kind: 'control', memories: [],
    prompt: 'Add `tollgate --version`, printing a package-level `version` variable in cmd/tollgate that release builds set with -ldflags (default "dev").',
    requirements: [],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'cmd/tollgate', file: 'main_version_test.go', pass: ['TestBenchVersionFlag'] });
      return { passed: run.passed, requirements: {}, detail: report(run) };
    },
  },
  {
    id: 'tollgate-healthz', project: 'tollgate', situation: 'S11', origin: 'invented', kind: 'control', memories: [],
    prompt: 'Add GET /healthz to the server, answering 200 with the body `ok`. Register it in `newMux` in cmd/tollgate/main.go.',
    requirements: [],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'cmd/tollgate', file: 'main_healthz_test.go', pass: ['TestBenchHealthz'] });
      return { passed: run.passed, requirements: {}, detail: report(run) };
    },
  },
  {
    id: 'tollgate-replay-to', project: 'tollgate', situation: 'S13', origin: 'invented', kind: 'memory',
    memories: ['relay/idle-timeout-under-30s'],
    prompt: 'Add `tollgate replay --to <url> <id>` to send a replay to another endpoint (staging) instead of the configured partner. Build what sends it in a new file cmd/tollgate/replay_client.go.',
    requirements: [{ id: 'idle_under_30s', auto: true, text: 'The new client keeps idle connections under 30 seconds: relay.NewHTTPClient() or an IdleConnTimeout of at most 29 s; never http.DefaultClient.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'cmd/tollgate', file: 'main_replay_to_test.go', pass: ['TestBenchReplayTo'] });
      const client = read(dir, 'cmd/tollgate/replay_client.go');
      const ok = Boolean(client) && idleUnder30s(client);
      return { passed: run.passed && Boolean(client), requirements: { idle_under_30s: ok }, detail: report(run, { 'replay_client.go': Boolean(client), 'idle under 30 s': ok }) };
    },
  },
  {
    id: 'tollgate-dedup-package', project: 'tollgate', situation: 'S14', origin: 'invented', kind: 'memory',
    memories: ['intake/dedup-window-72h'],
    prompt: 'Move deduplication out of intake into a new package internal/dedup with its own tests, exposing `New(max int) *Set`, `(*Set).Seen(id string, now time.Time) bool` and `(*Set).Len() int`. Keep intake and `serve` using it, and keep its memory bounded: under normal load it should hold no more than about 100,000 ids.',
    requirements: [{ id: 'window_kept', auto: true, text: 'Reaching the bound never evicts an id seen within the last 72 hours.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/dedup', file: 'dedup_bound_test.go', pass: ['TestBenchBounded'],
        requirements: { window_kept: 'TestBenchWindowKept' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-dedup-evict', project: 'tollgate', situation: 'S15', origin: 'invented', kind: 'memory',
    memories: ['intake/dedup-window-72h'],
    prompt: 'The dedup map in intake grows without bound under load. Make it evict old entries so that it stays around 50,000 ids under normal load.',
    requirements: [{ id: 'window_kept', auto: true, text: 'Reaching the bound never evicts an id seen within the last 72 hours.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/intake', file: 'intake_dedup_evict_test.go', pass: ['TestBenchEvicts'],
        requirements: { window_kept: 'TestBenchEvictKeepsWindow' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'tollgate-clock-test-fails', project: 'tollgate', situation: 'S16', origin: 'invented', kind: 'memory',
    memories: ['relay/signature-time-from-clock'], setup: overlay('tollgate-clock-test-fails'), setupMessage: 'Test the signature time',
    prompt: '`go test ./internal/relay` fails on TestForwardSignedAtClockTime. Fix it.',
    requirements: [{ id: 'uses_clock', auto: true, text: 'The relay signs with its Clock\'s time; internal/relay/relay.go calls no time.Now().' }],
    async check(dir) {
      const run = await goTests(dir, { pkg: 'internal/relay', tests: ['TestForwardSignedAtClockTime'] });
      const usesClock = !/time\.Now\(\)/.test(read(dir, 'internal/relay/relay.go'));
      const passed = run.results.TestForwardSignedAtClockTime;
      return { passed, requirements: { uses_clock: usesClock }, detail: report({ ...run, passed }, { 'no time.Now in relay.go': usesClock }) };
    },
  },
  {
    id: 'tollgate-store-compact', project: 'tollgate', situation: 'S17', origin: 'invented', kind: 'memory',
    memories: ['fsx/replace-files-through-fsx'],
    prompt: 'Add `tollgate compact`, rewriting the delivery log with only the latest line of each delivery and dropping delivered ones received more than 30 days ago. Put the rewrite in `store.Compact(dir string, now time.Time) error`.',
    requirements: [{ id: 'uses_replace_file', auto: true, text: 'The log is replaced through fsx.ReplaceFile; no os.Rename is added.' }],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/store', file: 'store_compact_test.go', pass: ['TestBenchCompact'] });
      const added = `${await addedGo(dir, 'internal/')}\n${await addedGo(dir, 'cmd/')}`;
      const usesReplace = /fsx\.ReplaceFile\(/.test(added) && !/os\.Rename\(/.test(added);
      return { passed: run.passed, requirements: { uses_replace_file: usesReplace }, detail: report(run, { 'fsx.ReplaceFile, no os.Rename': usesReplace }) };
    },
  },
  {
    id: 'tollgate-review-notify', project: 'tollgate', situation: 'S18', origin: 'invented', kind: 'memory',
    memories: ['partner/sign-the-bytes-sent'], setup: overlay('tollgate-review-notify'), setupMessage: 'Draft delivery notifications',
    prompt: 'A teammate added internal/relay/notify.go to send delivery notifications to Meridian. Review it before it ships: list the problems you find, most serious first. Do not change any code.',
    requirements: [{ id: 'flags_signature_mismatch', auto: true, text: 'The review names that the signature is computed over other bytes than the body sent.' }],
    async check(dir, answer) {
      const passed = await reviewed(dir, answer);
      const flagged = flags(answer, /\bsign/i, /\b(canonical\w*|re-?marshal\w*|marshal\w*|seriali[sz]\w*|different bytes|same bytes|exact bytes|raw body|bytes (?:sent|received))\b/i);
      return { passed, requirements: { flags_signature_mismatch: flagged }, detail: detail({ reviewed: passed, 'flags the mismatch': flagged }) };
    },
  },
  {
    id: 'tollgate-review-audit-log', project: 'tollgate', situation: 'S18', origin: 'invented', kind: 'memory',
    memories: ['logging/redact-payloads'], setup: overlay('tollgate-review-audit-log'), setupMessage: 'Log accepted events for support',
    prompt: 'A teammate added internal/intake/audit.go and a call to it in the handler, for the support team. Review it before it ships: list the problems you find, most serious first. Do not change any code.',
    requirements: [{ id: 'flags_unredacted_payload', auto: true, text: 'The review names that full payloads, with personal data, reach the logs.' }],
    async check(dir, answer) {
      const passed = await reviewed(dir, answer);
      const flagged = flags(answer, /\b(redact\w*|PII|personal (?:data|information)|e-?mails?|cards?|card_last4|phones?|phone numbers?|sensitive (?:data|information|fields?)|GDPR|privacy)\b/i);
      return { passed, requirements: { flags_unredacted_payload: flagged }, detail: detail({ reviewed: passed, 'flags the payload': flagged }) };
    },
  },
  {
    id: 'tollgate-invoice-voided', project: 'tollgate', situation: 'S19', origin: 'invented', kind: 'memory',
    memories: ['schema/types-are-generated'],
    prompt: 'Accept a new event type `invoice.voided` with the fields `invoice_id` (string) and `reason` (string).',
    requirements: [
      { id: 'schema_updated', auto: true, text: 'schema/events.json lists invoice.voided.' },
      { id: 'generated_not_edited', auto: true, text: 'internal/schema/types_gen.go is exactly what schemagen writes for schema/events.json.' },
    ],
    async check(dir) {
      const run = await hidden(dir, { pkg: 'internal/intake', file: 'intake_voided_test.go', pass: ['TestBenchVoidedAccepted'] });
      let listed = false;
      try { listed = JSON.parse(read(dir, 'schema/events.json')).types.some(t => t.name === 'invoice.voided'); } catch { /* not JSON */ }
      const tmp = mkdtempSync(join(tmpdir(), 'dd-tollgate-gen-'));
      let generated = false;
      try {
        const out = join(tmp, 'types_gen.go');
        const gen = await exec('go', ['run', './cmd/schemagen', '-in', 'schema/events.json', '-out', out], { cwd: dir });
        generated = gen.ok && read(tmp, 'types_gen.go') === read(dir, 'internal/schema/types_gen.go');
      } finally { rmSync(tmp, { recursive: true, force: true }); }
      return { passed: run.passed, requirements: { schema_updated: listed, generated_not_edited: generated },
        detail: report(run, { 'events.json lists it': listed, 'generated file current': generated }) };
    },
  },
  {
    id: 'tollgate-fixture-refund', project: 'tollgate', situation: 'S20', origin: 'invented', kind: 'memory',
    memories: ['testdata/index-sorted-bytewise'],
    prompt: 'Add a test fixture `Invoice.refund.json` under testdata/events: an `invoice.paid` event for invoice in_9001 with a negative `amount_cents` of -125000 in NOK. List it in the fixture index.',
    requirements: [{ id: 'bytewise_sorted', auto: true, text: 'testdata/events/index.txt stays in plain byte order.' }],
    async check(dir) {
      let parsed = false;
      try { parsed = JSON.parse(read(dir, 'testdata/events/Invoice.refund.json')).type === 'invoice.paid'; } catch { /* missing or not JSON */ }
      const lines = read(dir, 'testdata/events/index.txt').split(/\r?\n/).filter(Boolean);
      const listed = lines.includes('Invoice.refund.json');
      // JavaScript compares UTF-16 code units: for ASCII names, that is byte order.
      const sorted = lines.join('\n') === [...lines].sort().join('\n');
      return { passed: parsed && listed, requirements: { bytewise_sorted: sorted }, detail: detail({ 'fixture parses': parsed, listed, 'byte order': sorted }) };
    },
  },
];
