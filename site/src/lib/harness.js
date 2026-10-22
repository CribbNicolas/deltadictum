// Docs that depend on the harness. A fenced block whose meta says `for=codex`, or a run
// of blocks between `<!-- for: codex opencode -->` and `<!-- /for -->`, is a panel for
// those harnesses; adjacent panels form a group with a tab bar. The reader's choice (the
// sidebar's select, or a tab) is one global value kept in localStorage: CSS shows the
// panels for it. On GitHub, and without JavaScript, every panel shows.
// `status` is set for a harness short of full support, and every code block for it says so with `note`:
// preview (install, save, delivery and recall verified in a live session) or unverified (no live session yet).
export const HARNESSES = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex', status: 'preview', note: 'Install, save, delivery and recall verified live with codex-cli 0.163 (2026-10-22).' },
  { id: 'opencode', label: 'OpenCode', status: 'preview', note: 'Install, save, delivery and recall verified live with OpenCode 1.19.3 (2026-10-22).' },
  { id: 'grok', label: 'Grok Build', status: 'unverified', note: "Built from Grok's hook guide (grok 1.0.41); no real session recorded yet." },
];
export const STATUS_LABELS = { preview: 'Preview.', unverified: 'Not yet verified live.' };
export const DEFAULT_HARNESS = 'claude-code';
// The landing's install lines, the same steps Getting started gives: the hero shows `hero`, the
// footer every step. A line starting with # is a note, not a command.
export const INSTALL = {
  'claude-code': { hero: '/plugin install dd@deltadictum',
    steps: ['/plugin marketplace add CribbNicolas/deltadictum', '/plugin install dd@deltadictum', 'npx deltadictum init'] },
  codex: { hero: 'deltadictum install --host codex --project <path>',
    steps: ['npm install -g deltadictum', 'deltadictum install --host codex --project <path>'] },
  opencode: { hero: 'deltadictum install --host opencode --project <path>',
    steps: ['npm install -g deltadictum', 'deltadictum install --host opencode --project <path>'] },
  grok: { hero: 'grok plugin install CribbNicolas/deltadictum --trust',
    steps: ['grok plugin install CribbNicolas/deltadictum --trust', 'npx deltadictum init'] },
};
export const STORAGE_KEY = 'dd-harness';
const IDS = new Set(HARNESSES.map(h => h.id));

// Inlined in <head>: the stored choice, before the first paint.
export const headScript = `(function(){var h;try{h=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}`
  + `document.documentElement.dataset.harness=${JSON.stringify([...IDS])}.indexOf(h)>=0?h:${JSON.stringify(DEFAULT_HARNESS)}})();`;

// Every panel not for the chosen harness is hidden; the chosen harness's tab and picker button are marked.
export const harnessCss = [...IDS].map(id => `html[data-harness="${id}"] [data-for]:not([data-for~="${id}"]){display:none}`
  + `html[data-harness="${id}"] [data-set-harness="${id}"]{background:var(--surface-chip);color:var(--text-strong);font-weight:600;box-shadow:inset 0 -2px 0 var(--accent)}`
  + `html[data-harness="${id}"] [data-pick-harness="${id}"]{background:rgba(232,184,74,.12);color:var(--accent);border-color:var(--accent);font-weight:600}`).join('\n');

const OPEN = /^<!--\s*for:\s*([\w\s-]+?)\s*-->$/;
const CLOSE = /^<!--\s*\/for\s*-->$/;
const CODE_FOR = /(?:^|\s)for=([\w,-]+)/;

function harnessesOf(list, where) {
  const ids = list.split(/[\s,]+/).filter(Boolean);
  const unknown = ids.filter(id => !IDS.has(id));
  if (!ids.length || unknown.length) throw new Error(`${where}: unknown harness "${unknown.join(', ') || list}" (known: ${[...IDS].join(', ')})`);
  return ids;
}

const panel = (ids, children) => ({ type: 'harnessPanel', ids, children,
  data: { hName: 'div', hProperties: { className: ['harness-panel'], dataFor: ids.join(' ') } } });

const el = (name, props, children = []) => ({ type: 'harnessElement', children, data: { hName: name, hProperties: props } });
const text = value => ({ type: 'text', value });

// The one code block of the docs and the landing: a header with the harness tabs and a copy button, a
// strip for a harness short of full support, then the panels.
function codeCard(panels) {
  const covered = HARNESSES.filter(h => panels.some(p => p.ids.includes(h.id)));
  const tabs = el('div', { className: ['harness-bar'], role: 'tablist', ariaLabel: 'Harness' },
    covered.map(h => el('button', { type: 'button', role: 'tab', ariaSelected: 'false', className: ['harness-tab'], dataSetHarness: h.id }, [text(h.label)])));
  const head = el('div', { className: ['cb-head'] }, [tabs, el('button', { type: 'button', className: ['cb-copy'], dataCopy: '' }, [text('Copy')])]);
  const strips = covered.filter(h => h.status).map(h => el('p', { className: ['cb-status'], dataFor: h.id },
    [el('strong', {}, [text(STATUS_LABELS[h.status])]), text(` ${h.note}`)]));
  return { type: 'harnessGroup', children: [head, ...strips, el('div', { className: ['cb-body'] }, panels)],
    data: { hName: 'div', hProperties: { className: ['codeblock', 'harness-group'] } } };
}

// One parent's children: markers and tagged code become panels, adjacent panels a group.
function regroup(children, where) {
  const out = [];
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i];
    if (node.type === 'html' && OPEN.test(node.value.trim())) {
      const ids = harnessesOf(OPEN.exec(node.value.trim())[1], where);
      const end = children.findIndex((other, j) => j > i && other.type === 'html' && CLOSE.test(other.value.trim()));
      if (end === -1) throw new Error(`${where}: <!-- for: ${ids.join(' ')} --> is never closed with <!-- /for -->`);
      out.push(panel(ids, regroup(children.slice(i + 1, end), where)));
      i = end;
    } else if (node.type === 'html' && CLOSE.test(node.value.trim())) {
      throw new Error(`${where}: <!-- /for --> closes nothing`);
    } else if (node.type === 'code' && CODE_FOR.test(node.meta ?? '')) {
      const ids = harnessesOf(CODE_FOR.exec(node.meta)[1], where);
      out.push(panel(ids, [{ ...node, meta: node.meta.replace(CODE_FOR, '').trim() || null }]));
    } else {
      if (node.children) node.children = regroup(node.children, where);
      out.push(node);
    }
  }
  const grouped = [];
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].type !== 'harnessPanel') { grouped.push(out[i]); continue; }
    let j = i;
    while (out[j + 1]?.type === 'harnessPanel') j += 1;
    const run = out.slice(i, j + 1);
    // A lone panel is content for some harnesses only; a run of them is a choice, with tabs.
    grouped.push(run.length === 1 ? run[0] : codeCard(run));
    i = j;
  }
  return grouped;
}

// Every other code block gets the same card at build time, with a label for its language instead of tabs,
// and every table a scroll box, so the page never moves once it has loaded. A terminal block outside a
// harness group reads the same for every harness, and says so.
const LABELS = { bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', json: 'JSON', js: 'JavaScript', javascript: 'JavaScript', toml: 'TOML', yaml: 'YAML', text: 'Text' };

function card(code) {
  const label = LABELS[code.lang] ?? code.lang ?? 'Text';
  const head = el('div', { className: ['cb-head'] }, [el('span', { className: ['cb-label'] }, [text(label)]),
    ...(label === 'Terminal' ? [el('span', { className: ['cb-note'] }, [text('Same on every harness')])] : []),
    el('button', { type: 'button', className: ['cb-copy'], dataCopy: '' }, [text('Copy')])]);
  return { type: 'harnessGroup', children: [head, el('div', { className: ['cb-code'] }, [code])],
    data: { hName: 'div', hProperties: { className: ['codeblock'] } } };
}

function frame(children) {
  return children.map(node => {
    if (node.type === 'harnessGroup') return node;
    if (node.type === 'code') return card(node);
    if (node.type === 'table') return el('div', { className: ['table-wrap'] }, [node]);
    if (node.children) node.children = frame(node.children);
    return node;
  });
}

export function remarkHarness() {
  return (tree, file) => {
    tree.children = frame(regroup(tree.children, file?.path ?? 'markdown'));
  };
}
