---
name: review
description: Work DD revision requests and memories that need review. Use for /dd:review, optionally with a memory or action id.
---

# Review DD knowledge

Arguments: an optional memory or action id.

With an id:
1. Call `status`. If the id is among `revision_requests`, the reviewer's reason is there; read it exactly.
2. Call `get` on a memory id, read the current code and the evidence it cites.
3. For an open revision request, file the corrected version: `propose` with the same `topic_key` and `revises: <id>` for a memory, or `act` with `revises: <id>` for an action. Address the reason; change nothing else.
4. Without a revision request, judge whether the memory still holds against the code, then do one of:
   - file a revision with `propose` on the same `topic_key`;
   - `act` of kind `legacy` when the practice was abandoned and must not be repeated (give `legacy_reason`, and `replaced_by` when a memory replaced it);
   - `act` of kind `archive` when it is simply no longer useful (give `archived_reason`);
   - or tell the user it still holds.

Without an id: do the above for every entry in `status.revision_requests`, then for every memory that `retrieve` flags with EVIDENCE CHANGED or REVIEW REQUIRED.

Nothing changes until the user acts in the audit UI. End by saying what you filed and giving the address from `ui`. Never say anything was applied or approved.
