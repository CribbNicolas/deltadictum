// A blockquote that opens with bold text ending in ":" or "." (`> **Tip:** ...`,
// `> **One test.** ...`) renders as a callout; other blockquotes stay quotes.
import { walk } from './mdast.js';

const text = node => node.value ?? (node.children ?? []).map(text).join('');

export function remarkCallouts() {
  return tree => {
    walk(tree, node => {
      if (node.type !== 'blockquote') return;
      const first = node.children?.[0];
      const lead = first?.type === 'paragraph' ? first.children?.[0] : null;
      if (lead?.type !== 'strong' || !/[:.]$/.test(text(lead).trim())) return;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: ['callout'] } };
    });
  };
}
