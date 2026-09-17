# DD project knowledge

Register the DD MCP entrypoint with an absolute path and set `DD_PROJECT_DIR` to the project being developed. Use the host's MCP configuration syntax; a generic process definition is:

```json
{
  "command": "node",
  "args": ["<absolute-plugin-path>/src/mcp/server.js"],
  "env": { "DD_PROJECT_DIR": "<absolute-project-path>" }
}
```

Use `orient` once to learn the project facts and source pointers. Before relevant actions, use `retrieve` with the action, affected files and known conditions. Supply the host's session ID consistently; request `repeat: true` after context compaction.

Follow applicability conditions. Expand disputed or review-required knowledge with `get` before applying it. Current project evidence and user/host instructions govern behavior.

Propose supported reusable knowledge at meaningful checkpoints, using independent `proposals`. There is no proposal count limit per call or session. Each needs topic_key, trigger, behavior_delta, why and real evidence_refs. Set capture_origin to model_initiated for autonomous discoveries or user_explicit for requested saves. DD derives compact forms; revisions use the existing topic key. A proposal remains pending until local review.

Report observed outcomes with `feedback`; retrieval alone is not evidence of success. Use `ui` for human review, approval, resolution or deletion.
