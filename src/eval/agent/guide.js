// The project's memories written as one engineering guide, for the agent trial's
// documentation conditions: the same knowledge DD holds, delivered as a document
// in the repository instead of through hooks. Every authored field goes in, in
// full; what only DD uses (ids, topic keys, anchors, hashes) stays out.

const TYPES = { lesson: 'Lesson learned', decision: 'Decision', claim: 'Fact', procedure: 'Procedure', anti_memory: 'Anti-pattern' };
const AREAS = { ui: 'Audit UI', development: 'Development workflow', hygiene: 'Store hygiene', release: 'Release' };

// Topic keys are area/subject/...; dd/ and memory/ only say whose knowledge it is.
function area(topicKey) {
  const parts = topicKey.split('/');
  const name = ['dd', 'memory'].includes(parts[0]) && parts.length > 2 ? parts[1] : parts[0];
  return AREAS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

const list = values => (values ?? []).map(v => (typeof v === 'string' ? v : v.description ?? Object.values(v).join(' — '))).filter(Boolean);

export function guideSection(atom) {
  const scope = atom.applies_to ?? {};
  const scopeParts = [
    scope.files?.length && `files ${scope.files.map(f => `\`${f}\``).join(', ')}`,
    scope.components?.length && `components: ${scope.components.join(', ')}`,
    scope.operations?.length && `operations: ${scope.operations.join(', ')}`,
  ].filter(Boolean);
  const lines = [`### ${atom.title}`, '', `*${TYPES[atom.memory_type] ?? 'Note'}.* **Applies when:** ${atom.trigger}`, '', atom.behavior_delta, ''];
  if (atom.why) lines.push(`**Why:** ${atom.why}`, '');
  if (scopeParts.length) lines.push(`**Scope:** ${scopeParts.join('; ')}.`, '');
  for (const [label, values] of [['Assumptions', atom.assumptions], ['Alternatives considered', atom.alternatives], ['Revisit when', atom.revisit_when]]) {
    if (list(values).length) lines.push(`**${label}:** ${list(values).join('; ')}.`, '');
  }
  const refs = (atom.evidence_refs ?? []).filter(ref => ref.source_ref);
  if (refs.length) lines.push('**References:**', ...refs.map(ref => `- \`${ref.source_ref}\`${ref.summary ? `: ${ref.summary}` : ''}`), '');
  return lines.join('\n');
}

export function engineeringGuide(atoms) {
  const groups = new Map();
  for (const atom of atoms.filter(a => a.lifecycle_state === 'active').sort((a, b) => a.topic_key.localeCompare(b.topic_key))) {
    const name = area(atom.topic_key);
    groups.set(name, [...(groups.get(name) ?? []), atom]);
  }
  const out = ['# Engineering guide', '',
    'Conventions, pitfalls and decisions for working on this codebase, collected from past work. Each section says when it applies, what to do and why.', ''];
  for (const name of [...groups.keys()].sort()) out.push(`## ${name}`, '', ...groups.get(name).map(guideSection));
  return out.join('\n');
}
