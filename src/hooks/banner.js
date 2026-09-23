export const DEFAULT_UI_URL = 'http://127.0.0.1:7733';

// Shown to the person, not to the model: a bare URL on its own so the terminal
// linkifies it and the audit UI is one ctrl-click away.
export function uiPointer(url) {
  return `DD audit UI: ${url}`;
}

export function sessionBanner({ projectId, url, activeCount = 0 }) {
  return [
    `DD - loaded for \`${projectId}\` (${activeCount} active).`,
    // Explicit ask, not a passive fact: SessionStart output reaches the model
    // only, on every harness, so the model relaying it is the only path left
    // to the person. Phrased as an instruction because a neutral fact is a
    // judgment call the model can silently skip.
    url
      ? `DD - Audit UI: ${url} -- tell the user this URL near the start of your first reply this session, if you have not already.`
      // No live resident to name: a guessed or stale address sends the person to a refused connection.
      : 'DD - Audit UI: not running yet. The DD `ui` tool returns its address once the resident process is up.',
  ].join('\n');
}
