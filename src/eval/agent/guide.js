// The project's memories written as one engineering guide, for the agent trial's
// documentation conditions: the same knowledge DD holds, delivered as a document
// in the repository instead of through hooks. Every authored field goes in, in
// full; what only DD uses (ids, topic keys, anchors, hashes) stays out.

const AREAS = { ui: 'Review UI', development: 'Development workflow', hygiene: 'Store hygiene', release: 'Release' };

// Topic keys are area/subject/...; dd/ and memory/ only say whose knowledge it is.
function area(topicKey) {
  const parts = topicKey.split('/');
  const name = ['dd', 'memory'].includes(parts[0]) && parts.length > 2 ? parts[1] : parts[0];
  return AREAS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}


// A memory as a guide section: its body in full, when it applies as the triggers
// say it in prose, why the code does not show it, and its references.
// Ids, topics, hashes and review metadata stay out.
const KIND_LABELS = { trap: 'Trap', decision: 'Decision', failed_approach: 'Abandoned approach', fact: 'Fact', procedure: 'Procedure' };
const VERBS = { read: 'reading', edit: 'editing', write: 'writing', run: 'running', search: 'a search', prompt: 'a prompt' };
const code = values => values.map(v => `\`${v}\``).join(', ');
const quoted = values => values.map(v => `"${v}"`).join(', ');

export function clauseInProse(clause) {
  const on = (clause.on ?? []).map(kind => VERBS[kind] ?? kind).join(' or ');
  const parts = [];
  if (clause.paths?.length) parts.push(code(clause.paths));
  if (clause.commands?.length) parts.push(code(clause.commands));
  if (clause.symbols?.length) parts.push(`with ${code(clause.symbols)}`);
  if (clause.keywords?.length) parts.push(`mentioning ${quoted(clause.keywords)}`);
  let text = [on, ...parts].join(' ');
  if (clause.not?.length) text += `, unless ${quoted(clause.not)}`;
  if (clause.not_paths?.length) text += `, except ${code(clause.not_paths)}`;
  return text;
}

export function guideSection(memory) {
  const lines = [`### ${memory.title}`, '',
    `*${KIND_LABELS[memory.kind] ?? 'Note'}.* **Applies when:** ${(memory.triggers ?? []).map(clauseInProse).join('; ')}.`, '',
    memory.body, ''];
  if (memory.not_derivable) lines.push(`**Why the code does not show it:** ${memory.not_derivable}`, '');
  const refs = (memory.evidence ?? []).filter(entry => entry.type === 'file' && entry.path);
  if (refs.length) lines.push('**References:**', ...refs.map(entry => `- \`${entry.path}\`${entry.summary ? `: ${entry.summary}` : ''}`), '');
  return lines.join('\n');
}

export function engineeringGuide(memories) {
  const groups = new Map();
  const live = memories.filter(m => ['active', 'contested'].includes(m.status)).sort((a, b) => a.topic.localeCompare(b.topic));
  for (const memory of live) {
    const name = area(memory.topic);
    groups.set(name, [...(groups.get(name) ?? []), memory]);
  }
  const out = ['# Engineering guide', '',
    'Conventions, pitfalls and decisions for working on this codebase, collected from past work. Each section says when it applies, what to do and why.', ''];
  for (const name of [...groups.keys()].sort()) out.push(`## ${name}`, '', ...groups.get(name).map(guideSection));
  return out.join('\n');
}
