---
artifact_class: authored
owner_domain: memory
artifact_type: security
stability: draft
last_validated: 2026-09-30
depends_on:
  - memory/memory-admission-control.md
  - memory/evidence-ledger.md
used_by:
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Memory Security

Summary: retrieved knowledge is an attack surface. This document states the threat model, the defenses
the code carries and the tests that hold them.

> The earlier version of this file carried an embedding-leakage threat, a federation/multi-tenancy
> section and a "policy memory" tier. DD is a harness plugin with no tenants and no policy tier, and its
> embeddings never leave the machine: the model runs in the local resident process and vectors live in
> each project's own SQLite index. See [plugin constraints](../architecture/plugin-constraints.md). The
> user-facing summary of the boundary is [Security boundary](../guide/security.md); this file is the
> engineering view.

## Threat model

Memory crosses a trust boundary: content written in one session (by an agent, a commit or a hand edit)
is later injected into another agent's context. Every stored memory is untrusted input until it passes
deterministic checks and review. What DD protects against: other accounts on the machine, web pages
reaching the local audit UI, and text that did not pass review. What it does not: the agent itself,
which runs as the user and can write `.dd/` directly; review checks what the agent proposes, it is not
a lock against it.

## Write-path poisoning

A small number of malicious or low-quality entries can steer later retrieval (PoisonedRAG-class
attacks). Defenses:

- Admission refuses a proposal without the contract fields or evidence, with injection-like text,
  `<think>` blocks or code fences, in a language other than English, or carrying a credential in a
  recognizable shape (`src/engine/contract.js`, `src/engine/v2/admission.js`, `src/engine/v2/sanitizer.js`).
- Every proposal is a candidate. It is admitted by local review, or by auto-accept only when evidence DD
  hashed itself reaches the project's threshold; a model-supplied confidence, hash or approval label is
  ignored (INV-04).
- Source reliability caps attainable confidence: no volume of agent claims reaches the standing of one
  verified artifact (`src/engine/reliability.js`).
- A replacement never overwrites an effective memory silently: it supersedes only on admission, and a
  collision with another memory is flagged for the reviewer.

## Injection through committed knowledge

A knowledge file can arrive by any commit, bypassing proposal validation. On every read it is held to
the same limits: schema version, provenance fields, size and the injection phrase list
(`unsupportedReason`). A file that fails is never indexed or recalled and is listed by `health`. The text
injected into the agent is derived from the fields a reviewer reads (`deriveForms`), never taken from the
file's stored forms. The phrase list stops obvious instruction text, not a determined rewording, so human
review of what enters `.dd/` remains the control.

## Instruction hierarchy

Retrieved memory is advisory content, never a command, and never outranks the host or the user (INV-07).
Concretely: packs are labelled advisory; a disputed memory is flagged and never injected beside its
opponent; changed evidence is flagged; on OpenCode, where DD's context lands in the system prompt, it is
framed as data that never overrides the user or the host (`adapters/opencode/frame.js`).

## Local surfaces

- The audit UI and the resident's hook API listen on `127.0.0.1` only, refuse any other `Host` header
  (DNS rebinding), and require secrets from the owner-only registry `~/.dd-data/resident.json`: a UI key
  traded for an `HttpOnly`, `SameSite=Strict` cookie, a review token and a same-origin check for every
  change, and a separate hook token for hooks. Page scripts run only under a per-response CSP nonce.
- Evidence paths must resolve inside the repository after symlink resolution (INV-01).
- Observations and feedback are redacted before they are stored; local data directories are private to
  their owner on POSIX.

## Red-team tests

| Category | Where it is held |
|---|---|
| Poisoning and unsafe content | `tests/engine/v2/sanitizer.test.js`, `tests/engine/v2/admission.test.js`, `tests/engine/secrets.test.js` |
| Cross-project isolation | `tests/engine/write-retrieve.test.js`, `tests/engine/v6/contradiction.test.js`, `tests/store/project-resolution.test.js` |
| Source-reliability caps under volume | `tests/engine/reliability.test.js` |
| Audit UI and hook API access | `tests/ui/server.test.js`, `tests/hooks/bridge.test.js` |
| No self-approval over MCP | `tests/mcp/protocol.test.js` |

## Boundary to other docs

Admission rules live in `memory-admission-control.md`. Provenance and temporal validity live in
`evidence-ledger.md`. This document owns only the threat model and the security tests that span them.
