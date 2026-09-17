# Project cognition implementation plan

Status: implementation complete; local validation passed on 2026-09-10. Real-model outcome trials and native-host/visual verification are separate pending validation, detailed below. This plan supersedes conflicting v1 behavior in imported Orquesta documents.

## Objective

Improve project understanding, code decisions and development speed with bounded context across model families. The engine must supply the same evidence and applicability guarantees to every model. Model capability is not an authorization or quality signal.

## Architecture and invariants

1. **Knowledge contract:** one authored behavioral statement, rationale, applicability, assumptions, revision conditions, alternatives and traceable evidence. Compact forms are derived; existing V6 atoms remain readable.
2. **Lifecycle:** proposals are separate from effective decisions. An unapproved proposal cannot displace active knowledge. Human approvals are recorded by the local review surface, never inferred from a model-supplied field. All types start as candidates; version 0.2 does not automatically promote them.
3. **Persistence:** Git JSON is authoritative; SQLite is a rebuildable index plus local telemetry. Candidate files use immutable IDs; current topics remain readable by path. Mutations are serialized, multi-file changes are recoverable, and deletion checks identity.
4. **Evidence and validity:** verify local references and content hashes without executing referenced commands. Distinguish a verified artifact from proof that a claim follows from it. Recheck dependencies and revision conditions when recalling. Missing applicability information must remain visible.
5. **Project context:** derive bounded facts from manifests and repository structure, and combine them with reviewed architectural memories. Link to source files instead of ingesting the codebase or transcripts.
6. **Retrieval:** combine lexical/alias matching with structured action, file and component cues; enforce conditions before ranking. Preserve disputes and assumptions in every injected form. Budget the serialized agent payload and suppress unchanged repeats within an explicit session.
7. **Learning:** record use outcomes separately from retrieval frequency. Claimed success alone cannot promote knowledge or raise authority. Refutations and changed assumptions produce review signals.
8. **Capture:** select a small batch of independent reusable lessons; observe failures and explicit validation signals only, with bounded local retention.
9. **Evaluation:** regression coverage plus deterministic task replay against no-memory/static-instruction baselines. Export a provider-neutral real-model evaluation protocol; do not claim cross-model quality gains from synthetic tests.

## Delivery stages

- [x] A. Recoverable persistence, candidate isolation, identity-safe deletion, lifecycle regression tests.
- [x] B. Simplified knowledge contract, provenance verification, local human review, applicability and revision checks.
- [x] C. Structured retrieval, compact payload budgeting, form fallback, conflict preservation, project orientation, session deduplication.
- [x] D. Outcome feedback, selective capture, retention and review queues.
- [x] E. MCP/CLI/UI integration and synchronized host instructions.
- [x] F. Behavioral replay, multilingual and context-change cases, full-path performance checks, documentation and final verification.

## Validation gates

- An active canonical decision survives a pending replacement, rejection and restart.
- Approval archives the prior version and makes the replacement effective in a recoverable transaction.
- Deleting history cannot delete the current topic; concurrent writes cannot lose updates.
- A model cannot self-approve or forge verified evidence through MCP.
- Missing/changed evidence and incompatible assumptions cannot silently yield authoritative advice.
- A smaller budget cannot rescue a form that a larger budget inexplicably discards.
- Disputes remain visible through MCP and hooks; payload estimates respect the configured budget.
- Paraphrases, Spanish/English, file-specific constraints, changed context and harmful memories are represented in evaluation.
- Frequency alone does not increase evidence or authority; observations and feedback stay bounded and local.
- Tests report actual scope: deterministic engine checks, cold/warm runtime cost, and separately supplied real-model results.

## Deliberately excluded infrastructure

No required cloud model, embeddings service, graph database, federation or automatic code execution. Evidence-backed feedback and project context are implemented before those optional extensions.

## Recorded validation

Environment: Windows, Node 24.13.0, npm 11.6.2. Timings below are local observations, not service-level guarantees.

- `npm test`: 172 passing tests, zero failures. The last UI/MCP refinements also passed their nine affected tests, including inline JavaScript syntax and HTTP review checks.
- `npm run test:stress`: 12 passing tests. The actual child hook over 2,000 Git atoms measured 1,241 ms cold and 122 ms with the resident service. Repeated in-process retrieval measured p50 3 ms, p95 4 ms and p99 5 ms; 16 concurrent requests completed in 36 ms.
- `npm run eval`: 24/24 exact replay cases, precision/recall/F1 1.0. Estimated serialized context was 2,182 tokens versus 11,472 for the static fixture baseline (80.98% reduction). This is an authored regression set, not held-out model evidence.
- Model adapter protocol tested with a local mock, including answer-label removal and preservation of supplied usage. No real model APIs were invoked.
- Package dry run: version 0.2.0, 107 files, no publication. Root and nested skill copies synchronized; all three skills passed the skill validator.
- Browser runtime setup was attempted but failed before navigation with environment error `codex/sandbox-state-meta: missing field sandboxPolicy`. Visual and native-host installation verification remain pending; HTTP tests are not substituted for those claims.

Implementation and migration details: [architecture](../architecture/project-cognition.md), [model evaluation protocol](../evaluation/model-evaluation.md), [README](../../README.md).
