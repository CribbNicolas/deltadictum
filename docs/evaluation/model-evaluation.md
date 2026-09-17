# Evaluating DD

The product objective is better repository decisions with less context and development effort. Engine correctness is necessary, but it does not establish those outcomes by itself. DD separates three layers of evidence.

## 1. Engine regression and runtime checks

Run `npm test` for lifecycle, persistence, evidence, applicability, MCP protocol, hook behavior and HTTP review flows. Run `npm run test:stress` for scale and concurrency, including a child hook over 2,000 real Git knowledge files and reuse of the resident process.

Cold startup, a warm engine call and a resident hook are separate measurements. Report the machine, corpus and operation path with timings. Index-only microbenchmarks do not represent host latency. These tests do not exercise a real model or prove native installation in each agent host.

## 2. Deterministic retrieval replay

```text
npm run eval
```

`src/eval/cases.js` contains seven authored knowledge fixtures and 24 scenarios: exact language, paraphrases, Spanish, mismatched scope, changed facts, retired advice and unrelated tasks. `src/eval/replay.js` seeds the actual store and runs the actual retrieval engine. Fixtures are evaluation ground truth, not production approval evidence.

The report at `output/eval/replay.json` records expected/returned memories, review handling, exact cases, precision, recall, F1, estimated context cost and elapsed time. The command fails if F1 or exact-case accuracy is below 90%.

Context baselines are no supplied knowledge and all effective fixture knowledge as static instructions. The comparison charges serialized DD results, including metadata, against the static context. It excludes MCP tool schemas, host prompts, model output and future tool calls. The byte-based estimate is not provider billing data.

These scenarios are authored with the engine and vocabulary. A perfect result verifies regression behavior on this set; it is not a held-out retrieval score or proof of semantic generalization. Add failures from actual projects to a separate held-out set before tuning.

## 3. Opt-in model decision evaluation

The runner accepts a local Node adapter instead of assuming a provider, SDK, model name or credentials:

```text
npm run eval:models -- --adapter C:/path/provider-adapter.mjs --model MODEL_ID --out output/eval/model-results.json
```

`--limit N` selects the first N scenarios for an integration smoke test (1 to 24). A full run makes 72 adapter invocations: each of 24 tasks with `none`, `static` and `dd` context. Provider calls and their costs are controlled by the supplied adapter. The plugin does not make them implicitly.

Each invocation receives one JSON document on stdin:

```json
{
  "model": "MODEL_ID",
  "mode": "dd",
  "task": {
    "id": "payment-exact",
    "action": "when retrying payment requests",
    "components": ["payments"]
  },
  "context": [{ "topic_key": "payments/retry/idempotency", "content": "Reuse the original idempotency key." }],
  "choices": ["reuse_key", "new_migration", "inject_clock", "sqlite", "request_id", "delivery_id", "review_decision", "inspect_project"],
  "instruction": "The shared decision task instructions."
}
```

The adapter must query its chosen model and write exactly one JSON document to stdout:

```json
{
  "decision": "reuse_key",
  "usage": { "input_tokens": 420, "output_tokens": 12 }
}
```

Send diagnostics to stderr. Return actual provider usage when available; omit usage when unavailable. Do not estimate billing tokens as if the provider reported them. Keep provider prompts, sampling settings and output limits the same across modes. Never derive the decision from the scenario ID or implement the answer in the adapter.

The runner strips expected answers and review labels before invoking the adapter, bounds output and enforces a two-minute invocation timeout. Reports preserve each result, elapsed wall time and adapter-supplied usage. Unknown token usage remains null. The automated runner test uses a mock adapter only and makes no model calls.

This is a closed-choice decision benchmark. Its no-context fallback is `inspect_project`; it measures whether supplied project guidance leads to the expected decision. It does not measure generated code quality, total development time, or whether a real model independently discovers equivalent guidance by reading files.

## Repository task trials before product claims

Use representative, isolated repository checkouts with tasks held out from memory authoring. Include stale and misleading decisions, unfamiliar modules, cross-language code and projects with little reusable knowledge. Run the same tasks under no memory, existing static instructions and DD. Randomize order and repeat trials using pinned model versions and recorded settings.

For every run record:

| Outcome | Measurement |
| --- | --- |
| Task success | Independent hidden tests and acceptance criteria |
| Code quality | Blind review of the patch, regression defects, maintainability and unnecessary changes |
| Context cost | All provider input/output usage, including schemas, retries, retrieved evidence and repeated context |
| Development effort | End-to-end elapsed time, tool calls, file reads and human interventions |
| Harmful recall | Incorrect advice followed, stale advice detected and unnecessary abstentions |
| Operational cost | Cold/warm hook latency, review time, retention footprint and failed captures |

Compare each model against its own baseline before comparing model families. Report task-level distributions and uncertainty, not just an average. Faster or smaller models may benefit differently; a provider-independent contract does not guarantee equal effectiveness. Keep human review costs in the accounting.

Record real results separately from the synthetic replay. Until those trials run, the supported claim is that DD implements bounded, conditional project knowledge with tested lifecycle safeguards. Cross-model quality and development-speed gains remain hypotheses to measure.
