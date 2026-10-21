import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remarkHarness } from '../src/lib/harness.js';

const run = children => { const tree = { type: 'root', children }; remarkHarness()(tree, { path: 'x.md' }); return tree.children; };
const html = value => ({ type: 'html', value });
const para = text => ({ type: 'paragraph', children: [{ type: 'text', value: text }] });
const code = meta => ({ type: 'code', lang: 'text', meta, value: 'x' });

test('adjacent harness blocks become one group with a tab for each harness they cover', () => {
  const [intro, group, outro] = run([para('Install:'), code('for=claude-code'), html('<!-- for: codex -->'), para('Codex steps'), html('<!-- /for -->'),
    code('for=opencode,grok'), para('Then start a session.')]);
  assert.equal(intro.type, 'paragraph');
  assert.equal(outro.type, 'paragraph');
  assert.equal(group.type, 'harnessGroup');
  const [bar, ...panels] = group.children;
  assert.deepEqual(bar.children.map(tab => tab.data.hProperties.dataSetHarness), ['claude-code', 'codex', 'opencode', 'grok']);
  assert.deepEqual(panels.map(p => p.data.hProperties.dataFor), ['claude-code', 'codex', 'opencode grok']);
  assert.equal(panels[0].children[0].meta, null);
  assert.equal(panels[1].children[0].children[0].value, 'Codex steps');
});

test('a lone block is content for its harnesses only, without tabs, also inside a list', () => {
  const [lone] = run([html('<!-- for: opencode -->'), para('No Stop hook.'), html('<!-- /for -->')]);
  assert.equal(lone.type, 'harnessPanel');
  const [list] = run([{ type: 'list', children: [{ type: 'listItem', children: [code('for=codex')] }] }]);
  assert.equal(list.children[0].children[0].type, 'harnessPanel');
});

test('an unknown harness or an unclosed block fails the build, naming the page', () => {
  assert.throws(() => run([code('for=cursor')]), /x\.md: unknown harness "cursor"/);
  assert.throws(() => run([html('<!-- for: codex -->'), para('x')]), /never closed/);
  assert.throws(() => run([html('<!-- /for -->')]), /closes nothing/);
});
