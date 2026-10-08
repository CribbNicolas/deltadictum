// A first pass at the information-versus-capability test (research section 8):
// does the memory name something specific to this repository? It orders a
// person's review of migrated memories; it decides nothing.
const SIGNALS = [
  ['path', /(?:^|[\s`'"(])(?:[\w.-]+\/)+[\w.-]+\.\w+/],
  ['identifier', /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[a-z]+(?:_[a-z0-9]+)+\b|\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/],
  ['command', /`(?:npm|npx|node|git|deltadictum|claude|codex|grok|opencode)\s[^`]+`/],
  ['value', /\b\d+\.\d+\b|\b\d+\s?(?:ms|s|KB|MB|tokens|characters)\b/],
];

export function classifyMemory(memory) {
  const text = `${memory.title ?? ''}\n${memory.body ?? ''}`;
  const signals = SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return { topic: memory.topic, signals, class: signals.length >= 2 ? 'information' : signals.length === 1 ? 'unsure' : 'generic' };
}
