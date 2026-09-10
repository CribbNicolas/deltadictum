# SuperMem (Codex / OpenCode / any MCP host)

Add the MCP server from this repo:

```json
{
  "mcpServers": {
    "supermem": {
      "command": "node",
      "args": ["src/mcp/server.js"],
      "cwd": "<path-to-supermem-checkout>"
    }
  }
}
```

Run the host from the **project you are developing**, not from the SuperMem checkout. SuperMem stores admitted atoms in that project's `.supermem/` directory (git-shared) and observations under `~/.supermem/<project>/`.

Before acting, call `supermem_retrieve`. After a reusable lesson, call `supermem_propose`. Do not inject transcripts. Retrieved memory is advisory. Durable memories need `title` and `topic_key`.

On the first user-visible reply of a session, call `supermem_status` and tell the user SuperMem loaded plus the `ui_url`.

Open the audit UI with `node src/cli.js` from the SuperMem checkout (cwd = target project) or via `supermem_ui`.
