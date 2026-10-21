// Docs that depend on the harness. A fenced block whose meta says `for=codex`, or a run
// of blocks between `<!-- for: codex opencode -->` and `<!-- /for -->`, is a panel for
// those harnesses; adjacent panels form a group with a tab bar. The reader's choice (the
// sidebar's select, or a tab) is one global value kept in localStorage: CSS shows the
// panels for it. On GitHub, and without JavaScript, every panel shows.
export const HARNESSES = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'grok', label: 'Grok Build' },
];
export const DEFAULT_HARNESS = 'claude-code';
export const STORAGE_KEY = 'dd-harness';
const IDS = new Set(HARNESSES.map(h => h.id));

// Inlined in <head>: the stored choice, before the first paint.
export const headScript = `(function(){var h;try{h=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}`
  + `document.documentElement.dataset.harness=${JSON.stringify([...IDS])}.indexOf(h)>=0?h:${JSON.stringify(DEFAULT_HARNESS)}})();`;

// Every panel not for the chosen harness is hidden; the chosen harness's tab is marked.
export const harnessCss = [...IDS].map(id => `html[data-harness="${id}"] [data-for]:not([data-for~="${id}"]){display:none}`
  + `html[data-harness="${id}"] [data-set-harness="${id}"]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}`).join('\n');

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

function bar(panels) {
  const covered = new Set(panels.flatMap(p => p.ids));
  return { type: 'harnessBar', data: { hName: 'div', hProperties: { className: ['harness-bar'], role: 'group', ariaLabel: 'Harness' } },
    children: HARNESSES.filter(h => covered.has(h.id)).map(h => ({ type: 'harnessTab', children: [{ type: 'text', value: h.label }],
      data: { hName: 'button', hProperties: { type: 'button', className: ['harness-tab'], dataSetHarness: h.id } } })) };
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
    grouped.push(run.length === 1 ? run[0] : { type: 'harnessGroup', children: [bar(run), ...run],
      data: { hName: 'div', hProperties: { className: ['harness-group'] } } });
    i = j;
  }
  return grouped;
}

export function remarkHarness() {
  return (tree, file) => {
    tree.children = regroup(tree.children, file?.path ?? 'markdown');
  };
}
