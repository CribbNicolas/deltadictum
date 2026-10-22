// What every page does in the browser, the landing and the docs alike: the harness tabs and picker,
// the copy buttons of code blocks, sections that appear as they scroll in, and counters that count up.
// Without JavaScript the page reads complete: every panel and section shows, numbers show their value.
import { currentHarness, setHarness } from './harness-client.js';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

for (const tab of document.querySelectorAll('[data-set-harness]')) tab.addEventListener('click', () => setHarness(tab.dataset.setHarness));
for (const pick of document.querySelectorAll('[data-pick-harness]')) pick.addEventListener('click', () => setHarness(pick.dataset.pickHarness));
setHarness(currentHarness());

// A copy button copies the code its block shows now: the visible panel's code, or the block's own.
// Delegated, so blocks a page wraps after loading (Doc.astro) copy too.
document.addEventListener('click', async event => {
  const button = event.target.closest?.('[data-copy]');
  if (!button) return;
  const block = button.closest('.codeblock');
  const visible = [...block.querySelectorAll('pre')].filter(pre => pre.offsetParent !== null);
  // A prompt sign is decoration (aria-hidden), not part of the command.
  const plain = pre => {
    const code = (pre.querySelector('code') ?? pre).cloneNode(true);
    code.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());
    return code.textContent;
  };
  const text = visible.map(plain).join('\n').trim();
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch { button.textContent = 'Select and copy'; }
  setTimeout(() => { button.textContent = 'Copy'; }, 1500);
});

// Revealed once, the first time a quarter of the element is in view.
const revealed = [...document.querySelectorAll('[data-reveal]')];
if (still || typeof IntersectionObserver !== 'function') revealed.forEach(el => el.classList.add('shown'));
else {
  document.documentElement.classList.add('reveals');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('shown');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.25 });
  revealed.forEach(el => observer.observe(el));
}

// A number counts up from zero once, when it comes into view; its text is the final value until then.
for (const el of document.querySelectorAll('[data-count-to]')) {
  const total = Number(el.dataset.countTo);
  if (still || !Number.isFinite(total) || typeof IntersectionObserver !== 'function') continue;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / 1400);
      el.textContent = Math.round(total * (1 - (1 - t) ** 3)).toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  }, { threshold: 0.6 });
  observer.observe(el);
}
