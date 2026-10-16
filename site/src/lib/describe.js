// A page's meta description when its front matter has none: its first paragraph,
// stripped of Markdown, cut at a word boundary.
const NOT_PROSE = /^(#|```|\||<|>|[-*+] |\d+\. |!\[)/;

export function describe(body, max = 160) {
  const paragraph = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map(b => b.trim()).find(b => b && !NOT_PROSE.test(b));
  if (!paragraph) return '';
  const plain = paragraph.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, plain.lastIndexOf(' ', max - 1))}…`;
}
