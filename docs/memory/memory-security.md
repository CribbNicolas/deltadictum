---
artifact_class: authored
owner_domain: memory
artifact_type: security
stability: draft
last_validated: 2026-05-31
depends_on:
  - memory/memory-admission-control.md
  - memory/retrieval-router.md
  - memory/evidence-ledger.md
used_by:
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Memory Security

Summary: Shared and retrieved memory is an attack surface. This document defines the threat model, the instruction-hierarchy defense, and the red-team test categories for the memory subsystem.

## Threat Model

Memory crosses a trust boundary: content written by one agent or workflow is later retrieved and injected into another agent's context. Treat all stored memory as untrusted input until validated by deterministic policy.

## Write-Path Poisoning

A small number of malicious or low-quality entries can disproportionately steer later retrieval (PoisonedRAG-class attacks). Mitigations:

- Admission control rejects or downgrades writes lacking evidence, scope, or required behavioral fields (see `memory-admission-control.md`).
- Contested-state handling prevents a new write from silently overwriting higher-authority memory.
- Audit logging records every durable write with its evidence references.

## Embedding Leakage

Embeddings are not private. Vec2Text-class attacks can reconstruct source text from dense embeddings with high fidelity, so an embedding can leak the sensitive content it encodes. Consequences:

- Embeddings are treated as sensitive data, not opaque vectors.
- Exporting embeddings out of the local environment is a policy decision, not a default (relevant to V9 federation).
- "We did not upload the plaintext" is not sufficient; what embeddings may be shared, at what resolution, and with what defenses must be decided explicitly.

## Injection via Shared Memory — Instruction Hierarchy

If one principal can write memory read by another, it can inject instructions into shared state. Defense follows the instruction hierarchy: retrieved and injected memory is advisory only and must never override the system or security layer of the prompt (see Cognition Layering in `CLAUDE.md`). Concretely:

- Policy memory is read-only and high authority; user/agent-written memory cannot escalate above it.
- Shared-memory writes are scoped and serialized; cross-tenant reads require an explicit decision artifact (INV-01/INV-02, AG-07).
- A retrieved memory that contains imperative instructions is treated as content, not as a command to the executor.

## Red-Team Test Categories

The evaluation harness (`evaluation-harness.md`) must include:

| Category | What it proves |
|---|---|
| Poisoning resistance | Injected malicious memories do not steer retrieval or answers. |
| Cross-tenant isolation | No write or retrieval crosses project namespaces without a decision artifact. |
| Embedding leakage | Sensitive content cannot be reconstructed from shared embeddings. |
| Instruction-hierarchy integrity | Retrieved memory cannot raise its own priority above system/security layers. |
| Read-only policy integrity | Policy memory cannot be mutated by ordinary write paths. |

## Boundary to Other Docs

Admission rules live in `memory-admission-control.md`. Provenance and temporal validity live in `evidence-ledger.md`. Retrieval abstention and ranking live in `retrieval-router.md`. This document owns only the threat model and the security tests that span them.
