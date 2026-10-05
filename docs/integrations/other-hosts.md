# Other MCP hosts

**Status: not tested.** Any harness that speaks MCP can use DD's tools. Without hooks there is no push
before prompts and tool calls: the agent recalls through `orient` and `retrieve`, as the
[generic host instructions](../../adapters/AGENTS.md) tell it to.

## Install

Install the package where it will stay, then register its MCP server:

```bash
npm install -g deltadictum
```

```json
{
  "command": "node",
  "args": ["<global node_modules>/deltadictum/src/mcp/server.js"],
  "env": { "DD_PROJECT_DIR": "<absolute-project-path>" }
}
```

`npm root -g` prints the global `node_modules` directory. Use an absolute script path. `DD_PROJECT_DIR`
names the project independently of the directory the host starts the server in; when it is omitted, the
server's working directory is used.

Add the contents of [`adapters/AGENTS.md`](../../adapters/AGENTS.md) to the host's project instructions so
the agent knows when to call each tool.

## The audit UI

The MCP server starts the [resident](../guide/resident.md) when none is running; the `ui` tool returns
the audit UI address. To start it by hand, from the project:

```bash
deltadictum
```

## Hooks

The repository also carries plugin manifests and `hooks/hooks.json` for harnesses that load Claude
Code-style plugins. Whether a given host runs them must be checked in that host. A hook failure never
blocks the host.
