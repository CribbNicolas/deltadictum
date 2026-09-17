---
name: dd-audit
description: Inspect DD project knowledge, evidence, pending revisions and task outcomes, and open the local human review interface.
---

# Review project knowledge

Use `status` and paginated `list` for an overview. Use `get` for the particular decision's rationale, assumptions, revision conditions and evidence. `health` reports crowding and unresolved disputes, not correctness.

Call `ui` and give the user its local URL to approve or reject candidates, resolve disputes, review counterevidence or delete a version. These actions are intentionally absent from the agent's MCP surface.

To suggest a correction, submit a new proposal with the existing topic key. Keep the current decision effective until review. Do not infer authorization or evidence from another model's confidence.
