import { readFileSync } from 'node:fs';

// The version this tree ships, read once from its package.json; null when unreadable.
export const VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? null; } catch { return null; }
})();
