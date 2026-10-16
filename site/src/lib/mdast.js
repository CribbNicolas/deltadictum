// Visits every node of a Markdown syntax tree, depth first.
export function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
