---
artifact_class: authored
owner_domain: memory
artifact_type: architecture
stability: draft
last_validated: 2026-05-30
depends_on:
  - memory/behavioral-memory-architecture.md
used_by:
  - memory/memory-admission-control.md
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Memory Orchestrator

Summary: `agent-memory` is a deterministic orchestrator with bounded AI proposal points.

## Design Rule

Specialist does not mean autonomous agent. Specialist means isolated responsibility with a clear contract.

## Internal Capabilities

```text
Memory Orchestrator
├── Admission Gate
├── AI Extractor
├── Cataloger
├── Verifier
├── Retriever
├── Conservator Worker
└── Policy Engine
```

## Deterministic Responsibilities

Sanitization, schema validation, permission checks, scope checks, TTL policy, lifecycle transitions, hash dedupe, budget limits, audit logging, and durable state mutation are deterministic.

## AI Proposal Responsibilities

LLMs may propose claims, lessons, anti-memories, procedures, topic keys, semantic duplicates, contradiction candidates, retrieval intent, and retrieval explanations.

## Autonomy Levels

| Level | Behavior |
|---|---|
| Level 1 | Automatic safe actions: create observations, sanitize, reject invalid memory, dedupe exact, retrieve micro-memories. |
| Level 2 | AI proposal with deterministic validation: create lessons, anti-memories, topic keys, relations, and summaries. |
| Level 3 | Requires policy or human review: delete canonical memory, deprecate decisions, resolve strong contradictions, change permissions. |

## IA Proposes, System Disposes

LLM output never mutates memory directly. An AI capability emits a `MemoryProposal`; deterministic code validates and commits it.

```json
{
  "proposal_type": "create_memory",
  "memory_type": "anti_memory",
  "title": "Do not compact empty raw events",
  "trigger": "compaction event has empty raw content",
  "behavior_delta": "Skip compaction and record a structured error instead of calling /compact",
  "what": "Compaction requires non-empty raw input.",
  "why": "Compacting empty raw creates false success paths and invalid durable memory.",
  "evidence_refs": ["trace:abc", "workflow:n8n-memory-compaction"],
  "confidence": 0.78,
  "scope": "workflow",
  "topic_key": "memory/compaction/non_empty_raw"
}
```

Deterministic gate then checks: schema valid, evidence refs exist, scope allowed, topic-key conflict, duplicate, contradiction, authority required, candidate vs active. Only then does it write.

## Determinism Boundary

| Area | AI | Deterministic |
|---|---|---|
| Sanitize raw output / fences / `<think>` | No | Yes |
| Validate schema; detect missing fields | No | Yes |
| Extract meaning from raw text | Yes | No |
| Classify memory type | Proposes | Validates |
| Assign scope | Suggests | Restricts |
| Compute TTL by type | Partial | Yes |
| Permission checks | No | Yes |
| Exact-hash dedupe | No | Yes |
| Semantic duplicate | Yes | Yes, with threshold |
| Detect contradiction | Yes | Yes, as gate |
| Resolve strong contradiction | Not alone | Yes / human |
| Delete memory | No | Yes, policy/worker |
| Supersede canonical memory | Not alone | Yes / human |
| Final retrieval ranking | Partial | Yes, by formula |
| Context injection | Partial | Yes, by budget/policy |

## When to Use Real Agents

Most specialists are deterministic functions or single LLM calls with an output schema. Promote a capability to a real background agent only when reasoning is qualitatively different and cost is justified: a Verifier agent for complex semantic contradiction, a Cataloger agent for cross-project/cross-lingual naming, a Conservator agent for merge/archive/supersede proposals, a Reference agent for explaining why memories apply. Sanitizer, schema validator, permission checker, TTL, lifecycle transitions, hash dedupe, budget limits, and audit logging stay as code.

## Internal Module Layout (deferred to V2 code phase)

The intended internal shape of the single `agent-memory` service — `admission/`, `extraction/`, `cataloging/`, `verification/`, `retrieval/`, `conservation/`, `policy/` — is a code-phase concern. It is recorded here for orientation only; this documentation phase does not create those modules.
