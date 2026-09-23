---
artifact_class: authored
owner_domain: memory
artifact_type: security
stability: draft
last_validated: 2026-05-31
depends_on:
  - memory/memory-admission-control.md
  - memory/evidence-ledger.md
used_by:
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Memory Security

Summary: retrieved knowledge is an attack surface. This document defines the threat model, the instruction-hierarchy defense, and the red-team test categories.

> The earlier version of this file carried an embedding-leakage threat and a federation/multi-tenancy
> section. DD is a harness plugin: it computes no embeddings and has no tenants, so those threats do
> not exist and were removed rather than restated. See
> [plugin constraints](../architecture/plugin-constraints.md). The threat that replaces them is
> source reliability: content reaching memory from a tool result or a fetched page must never attain
> the standing of a verified artifact or an explicit user correction.

## Threat Model

Memory crosses a trust boundary: content written by one agent or workflow is later retrieved and injected into another agent's context. Treat all stored memory as untrusted input until validated by deterministic policy.

## Write-Path Poisoning

A small number of malicious or low-quality entries can disproportionately steer later retrieval (PoisonedRAG-class attacks). Mitigations:

- Admission control rejects or downgrades writes lacking evidence, scope, or required behavioral fields (see `memory-admission-control.md`).
- Contested-state handling prevents a new write from silently overwriting higher-authority memory.
- Audit logging records every durable write with its evidence references.

## Injection via Shared Memory — Instruction Hierarchy

If one principal can write memory read by another, it can inject instructions into shared state. Defense follows the instruction hierarchy: retrieved and injected memory is advisory only and must never override the system or security layer of the prompt (see Cognition Layering in `CLAUDE.md`). Concretely:

- Policy memory is read-only and high authority; user/agent-written memory cannot escalate above it.
- Writes are scoped and serialized; cross-project reads require an explicit decision artifact (INV-01, INV-02).
- A retrieved memory that contains imperative instructions is treated as content, not as a command to the executor.

## Red-Team Test Categories

The evaluation harness (`evaluation-harness.md`) must include:

| Category | What it proves |
|---|---|
| Poisoning resistance | Injected malicious memories do not steer retrieval or answers. |
| Cross-project isolation | No write or retrieval crosses project namespaces without a decision artifact. |
| Instruction-hierarchy integrity | Retrieved memory cannot raise its own priority above system/security layers. |
| Read-only policy integrity | Policy memory cannot be mutated by ordinary write paths. |

## Boundary to Other Docs

Admission rules live in `memory-admission-control.md`. Provenance and temporal validity live in `evidence-ledger.md`. Retrieval abstention and ranking live in `src/engine/retrieve.js`. This document owns only the threat model and the security tests that span them.
