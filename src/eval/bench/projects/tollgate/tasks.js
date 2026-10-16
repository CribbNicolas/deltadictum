// tollgate's candidate tasks (docs/superpowers/plans/2026-10-16-bench-02-tollgate.md, Tasks 5-7). Each
// check runs a hidden Go test from hidden/ in one package, and static checks over the lines the change
// added. `passed` says the task as asked works; `requirements` say what the memory requires.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { changed, detail } from '../fixture-checks.js';
import { addedGo, goHidden } from './checks.js';

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
];
