import { ensureDependencies, manualInstallCommand } from './src/deps.js';

// A host that copied the plugin without its packages (src/deps.js) would see the
// server exit on its first import. Say why on stderr, which hosts log, and start
// the install; the server is available once the host reconnects after it ends.
const deps = ensureDependencies();
if (deps.state !== 'present') {
  process.stderr.write(`DD: the MCP server's packages are being installed in the background${deps.failed ? ` (the previous attempt failed: ${deps.failed})` : ''}. Reconnect the server once it finishes, or install them by hand: ${manualInstallCommand(deps.root)}\n`);
  process.exit(1);
}
await import('./src/mcp/server.js');
