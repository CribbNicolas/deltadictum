---
artifact_class: authored
owner_domain: memory
artifact_type: testing
stability: draft
last_validated: 2026-09-10
depends_on:
  - memory/evaluation-harness.md
  - specs/2026-09-09-retrieval-hot-path-and-scale.md
  - specs/2026-09-10-memory-deterioration-detection.md
used_by:
  - superpowers/plans/2026-09-10-memory-deterioration-detection.md
---

# Memory quality and performance tests

Date: 2026-09-10
Status: Catalog. Run the `gate` + `stress` rows now. Write the `cut` rows with deterioration detection. `later` stays out of that implementation.

Commands:

```text
npm test              # gate (~10s)
npm run test:stress   # performance at 2k atoms (~12s)
npm run test:all      # both
SUPERMEM_STRESS_ATOMS=5000 npm run test:stress
```

Status legend:

| Status | Meaning |
|---|---|
| `gate` | Already in `npm test`. Must stay green. |
| `stress` | Already in `npm run test:stress`. |
| `cut` | Required when implementing deterioration detection. Not optional. |
| `later` | Needed for memory quality, not in the detection cut. |

Pass criteria are the numbers to assert. If a row has no file yet, the implementer creates it under the path in **Where**.

---

## 1. Performance (retrieve and detector)

The engine must stay O(hits) for retrieve and cheap enough for health that a bloated live set cannot melt the plugin.

| # | Proof | Pass criteria | Where | Status |
|---|---|---|---|---|
| P1 | Needle buried under 1,000 newer fillers is found via FTS, ≤8 hits, no `evidence_refs`, `< 1s` | `elapsed < 1000`, needle present | `tests/engine/write-retrieve.test.js` | `gate` |
| P2 | MCP retrieve at 2,000 atoms finds buried needle, compact, `< 1s` | `elapsed < 1000`, no `what` / `retrieval_forms` / `evidence_refs` | `tests/stress/plugin-scale.test.js` | `stress` |
| P3 | 40 sequential MCP retrieves stay in one latency class | p95 `< 500ms`, p99 `< 1000ms` | same | `stress` |
| P4 | 16 concurrent MCP retrieves | wall `< 3000ms`, every result compact, ≤8 hits | same | `stress` |
| P5 | `supermem_status` and SessionStart at corpus scale | status `< 100ms`, session-start `< 1000ms` | same | `stress` |
| P6 | Retrieve does not rewrite git under load | git JSON bytes unchanged | same + `tests/store/sqlite-index.test.js` | `gate` + `stress` |
| P7 | Payload tokens vs `content` | `payloadTokens < contentTokens * 12 + 120` and `budget.used <= payloadTokens` | stress | `stress` |
| P8 | Same class at 5,000 atoms | P2–P5 still pass | `SUPERMEM_STRESS_ATOMS=5000 npm run test:stress` | `stress` |
| P9 | `assessDeterioration` on 200 live atoms with distinct triggers | `< 100ms` | `tests/engine/health/deterioration.test.js` | `cut` |
| P10 | `assessDeterioration` on 2,000 live atoms | `< 1000ms`; still returns a report; offenders cap 20 | `tests/stress/health-scale.test.js` | `cut` |
| P11 | `loadHealthSnapshot` at 2,000 atoms | `< 200ms`; no `payload`/`what` on rows | `tests/store/health-snapshot.test.js` or stress | `cut` |
| P12 | 50× `assessDeterioration` does not bump `activation_count` or grow `memory_retrieval_events` | counts identical before/after | `tests/store/health-snapshot.test.js` | `cut` |
| P13 | Health on a 2,000-atom corpus does not walk git | git mtime/bytes unchanged | `tests/stress/health-scale.test.js` | `cut` |

Measured once on this machine (not a pass bar, a baseline to beat):

| Corpus | retrieve | p50 / p95 / p99 | 16 concurrent | payload vs content |
|---|---|---|---|---|
| 2,000 | 8ms | 5 / 6 / 13ms | 80ms | 114 vs 10 tokens |
| 5,000 | 12ms | 5 / 6 / 7ms | 79ms | 114 vs 10 tokens |

---

## 2. Retrieval quality (activation, abstention, budget)

| # | Proof | Pass criteria | Where | Status |
|---|---|---|---|---|
| Q1 | Exact trigger match injects `short` | `form_type === 'short'`, expected content | `tests/engine/write-retrieve.test.js` | `gate` |
| Q2 | Compact MCP hit: no `evidence_refs`, no evidence path in JSON | `evidence_refs === undefined` | `tests/mcp/tools.test.js` | `gate` |
| Q3 | Unrelated action abstains | `abstained`, `memories.length === 0` | write-retrieve + stress | `gate` + `stress` |
| Q4 | Hard cap 8 even when many atoms share a trigger | `memories.length <= 8` | write-retrieve + stress | `gate` + `stress` |
| Q5 | Stopwords do not inflate overlap (`before writing tests` vs `before writing durable memory`) | score `< 0.5` and `> 0` | `tests/engine/v4/trigger-match.test.js` | `gate` |
| Q6 | Default VPT is 0.02 | config + retrieve honors `config.vpt_threshold` | git-file-store + sqlite-index tests | `gate` |
| Q7 | FTS query drops stopwords, quotes, OR-combines | exact query string | `tests/engine/v4/fts-query.test.js` | `gate` |
| Q8 | Form selection never upgrades; downgrades full→short→micro | `tests/engine/v4/forms.test.js` | `gate` |
| Q9 | Cross-project retrieve is empty | `memories.length === 0` | write-retrieve + stress | `gate` + `stress` |
| Q10 | Shared-stopword flood cannot fill past 8 | `memories.length <= 8` | stress | `stress` |
| Q11 | Abstention F1 on a labeled fixture set (should-inject vs should-abstain, ≥20 cases) | F1 `>= 0.8` | `tests/engine/health/abstention-eval.test.js` or eval harness | `later` |
| Q12 | Tool-result tokens and `budget.used` stay within 4× of sum(`token_estimate`) after dropping pretty-print | ratio `< 4` | stress, after payload trim | `later` |
| Q13 | `superseded` / `rejected` / `archived` never appear in normal retrieve | no those ids in hits | new retrieve test | `later` |
| Q14 | Contested hits include `contradicts` ids from sqlite relations | `hit.contradicts` includes peer | new retrieve test | `later` |

Q11 is the quality test the hot-path spec deferred. Detection (cap_saturation) is a proxy, not a substitute.

---

## 3. Write-path quality (admission, cleanliness, evidence)

| # | Proof | Pass criteria | Where | Status |
|---|---|---|---|---|
| W1 | Complete lesson → `write` | decision `write` | `tests/engine/v2/admission.test.js` + write-retrieve | `gate` |
| W2 | Missing trigger → `observe`, nothing retrievable | `atom === null`, retrieve abstains | write-retrieve | `gate` |
| W3 | Unsafe / think-block / dangling think → `block` | `tests/engine/v2/admission.test.js` | `gate` |
| W4 | Sanitizer strips think + fences | `tests/engine/v2/sanitizer.test.js` | `gate` |
| W5 | Retrieved-memory instruction injection cannot become active memory | v2 admission | `gate` |
| W6 | Anti-memory requires preventive language | v2 admission | `gate` |
| W7 | V3: supporting evidence required, dangling links observed, cross-project 403 | `tests/engine/v3/*.test.js` | `gate` |
| W8 | Evidence hash / TTL / sensitivity redaction | v3 evidence | `gate` |
| W9 | Live topic uniqueness on git put | `tests/store/git-file-store.test.js` | `gate` |
| W10 | Same-key material change supersedes and bumps predominance | write-retrieve + v6 supersession | `gate` |
| W11 | Duplicate-rate / observe-rate per 1,000 proposes | metrics from `memory_admission_decisions` | eval harness | `later` |

---

## 4. Contradiction, lifecycle, isolation, poisoning

| # | Proof | Pass criteria | Where | Status |
|---|---|---|---|---|
| L1 | Explicit contradiction validation (missing, cross-project, scope, self) | v6 contradiction | `gate` |
| L2 | Predominance order: evidence > recency > authority > predominance | v6 predominance | `gate` |
| L3 | Namespace: search/list/retrieve never cross `project_id` | sqlite-index + write-retrieve + stress | `gate` + `stress` |
| L4 | Canonical delete requires `confirm=true` | MCP tools | `gate` |
| L5 | Poisoning: model-output markers never durable | v2 admission/sanitizer | `gate` |
| L6 | Sensitive reconstruction in red-team prompts | `memory-security.md` | `later` |
| L7 | Unresolved contest older than 7 days is `watch` in health | deterioration tests | `cut` |

---

## 5. Deterioration detector (this cut)

Every row here is `cut`. Implement in the plan tasks; do not ship detection without them.

| # | Proof | Pass criteria | Where |
|---|---|---|---|
| D1 | Default thresholds match the spec | exact numbers | `tests/engine/health/deterioration.test.js` |
| D2 | Jaccard ignores stopwords; substring is not 1 | `before writing durable memory` vs `before writing tests` = 1/4 | same |
| D3 | Rollup: deteriorated > watch > healthy; skipped ignored | helpers | same |
| D4 | 3 live non-colliding lessons → `healthy`, B skipped | `status === 'healthy'` | same |
| D5 | 30 live under `memory/admission/*` → `prefix_crowding` deteriorated | without retrieve events | same |
| D6 | Non-colliding writing-triggers stay `trigger_collision` healthy | Jaccard 1/4 | same |
| D7 | Pair with Jaccard ≥ 0.5 → `watch` | one offender pair | same |
| D8 | Dead inferred: 14d + count 0 + inferred/observed only; canonical excluded | value 1, offender `old` | same |
| D9 | Contest 7d+ → `watch` | value 1 | same |
| D10 | 5 superseded on one key → `supersession_churn` deteriorated | value 5 | same |
| D11 | `live_bloat` counts only active+contested | 80 → watch | same |
| D12 | <10 retrieve events → `cap_saturation` skipped; overall follows A | 9× eight-hit events still healthy if A is | same |
| D13 | 10 events × 8 ids → `cap_saturation` deteriorated | value 1 | same |
| D14 | Abstentions are not saturated | 10 empty → healthy, value 0 | same |
| D15 | Snapshot has no `payload` / `what` / `evidence_refs` | store test | `tests/store/health-snapshot.test.js` |
| D16 | Detection does not dirty git or bump `activation_count` | bytes + count 0 | same |
| D17 | MCP `supermem_health` on empty project is healthy | `tests/mcp/tools.test.js` | same |
| D18 | Observation backlog is in the report and does **not** flip `status` | 100 unreviewed, 3 healthy lessons → `healthy` | health tests |
| D19 | Offenders arrays length ≤ 20 even when 40 prefixes/pairs qualify | health tests | same |
| D20 | Config `health.live_bloat.watch` override is honored | saveConfig then assess | store test |
| D21 | P9–P13 (detector performance) | see table 1 | stress + unit |

---

## 6. Host / cannot fully automate

These affect whether memories *do* anything. Automate the plugin side; the rest is a checklist when running against Grok/Claude.

| # | Proof | How |
|---|---|---|
| H1 | First assistant reply includes SuperMem banner + audit URL | SessionStart / MCP instructions |
| H2 | UserPromptSubmit hook calls retrieve (Grok ignores SessionStart stdout) | exercise hook `prompt` |
| H3 | Model calls `supermem_retrieve` before a matching action | manual / trace |
| H4 | Model does not dump full atoms when `supermem_get` is unnecessary | manual |
| H5 | After a Stop, at most one propose (not a session dump) | later capture cut |

---

## Gate for the deterioration cut

Do not merge detection unless:

1. `npm test` green (all `gate` rows).
2. All `cut` rows D1–D21 exist and pass.
3. `npm run test:stress` green (P2–P8).
4. No new call path from health → `retrieveMemories` or `putAtom`.

`later` rows (Q11–Q14, W11, L6, H5) are not merge blockers for detection. They are the next quality bar after the detector exists.
