# DeltaDictum current contract

Version 0.2 / schema 7 is defined by [project cognition](architecture/project-cognition.md) and implemented by the engine, store and transport tests.

- Knowledge is conditional engineering guidance: action, rationale, scope, assumptions, revision conditions and evidence.
- Project isolation precedes retrieval. Derived project facts are source-attributed.
- A proposal never displaces an effective decision. Only local review promotes or resolves it.
- Capture has no proposal count limit per call or session. Automatic reminders use independent turn guards; they cannot block explicit proposals.
- A user prompt carrying corrective language is recorded as a bounded local observation with `user_correction` provenance, detected by a deterministic English/Spanish rule in the prompt hook. It is evidence a proposal may cite, never knowledge; a detected correction promotes nothing and sets no confidence, and a failure to record one never withholds the turn's retrieval context.
- `capture_origin` distinguishes model initiative from an explicit request to save knowledge. Missing values default to `user_explicit`, including historical memories. Capture, transport and approval remain separate.
- Artifact verification establishes provenance/integrity; review assesses claim support.
- Source reliability caps attainable confidence. One declared ordinal ladder ranks unverified agent claim below host observation below repository artifact below observed user correction; the cap is applied at admission, evidence volume does not exceed it, and `capture_origin` can only lower it. A reviewer granting `canonical` is not clamped; nothing else rises above the ladder.
- Advice remains subordinate to host instructions, user intent and current project evidence.
- Every compact form preserves applicability. Disputed or stale knowledge remains explicitly qualified.
- Context budgets account for the serialized result, using a documented model-independent estimate.
- Local telemetry distinguishes retrieval, outcomes and evidence. Frequency is not correctness.
- Mutations are serialized and recoverable. Git is knowledge authority; SQLite is derived indexing plus local telemetry.

**DD is a plugin for coding-agent harnesses, not a service.** [`architecture/plugin-constraints.md`](architecture/plugin-constraints.md) states the seven limits that follow from that and is the boundary every other document operates inside. Documents describing a service — a database engine, a vector store, an inference server, background workers, federation — have been removed rather than deferred. Specifications under `docs/specs/` are historical design records; they do not override this contract, and only those marked `stability: implemented` describe current behaviour.

The engine retains tested V2–V6 helper modules for compatibility/reference. Runtime decisions use the schema-7 contract and lifecycle layer. No future roadmap phase is claimed as implemented merely because a historical helper exists.
