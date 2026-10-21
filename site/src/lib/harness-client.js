// The reader's harness in the browser: one value for every page, set from the sidebar's
// select or a tab, kept in localStorage when it can be. The head script (headScript)
// applies it before the first paint, so a page never flashes another harness's panels.
import { DEFAULT_HARNESS, HARNESSES, STORAGE_KEY } from './harness.js';

const IDS = HARNESSES.map(h => h.id);

export const currentHarness = () => document.documentElement.dataset.harness ?? DEFAULT_HARNESS;

export function setHarness(id) {
  if (!IDS.includes(id)) return;
  document.documentElement.dataset.harness = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode: the choice lasts the page */ }
  for (const select of document.querySelectorAll('[data-harness-select]')) select.value = id;
  for (const tab of document.querySelectorAll('[data-set-harness]')) tab.setAttribute('aria-pressed', String(tab.dataset.setHarness === id));
}
