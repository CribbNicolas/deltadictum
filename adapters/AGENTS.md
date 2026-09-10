# DeltaDictum / DD (Codex / OpenCode / any MCP host)

Add the MCP server from this repo:

```json
{
  "mcpServers": {
    "dd": {
      "command": "node",
      "args": ["src/mcp/server.js"],
      "cwd": "<path-to-deltadictum-checkout>"
    }
  }
}
```

Run the host from the **project you are developing**, not from the DeltaDictum checkout. Admitted atoms live in that project's `.supermem/` directory (git-shared) and observations under `~/.supermem/<project>/`.

Before acting, call `retrieve`. After a reusable lesson, call `propose`. Do not inject transcripts. Retrieved lessons are advisory. Durable lessons need `title` and `topic_key`.

On the first user-visible reply of a session, call `status` and write **only**:

```
DD - loaded for `<project_id>` (N active).
DD - Audit UI: <ui_url>
```

Never write SuperMem or DeltaDictum in chat.

Open the audit UI with `node src/cli.js` from the checkout (cwd = target project) or via `ui`.
