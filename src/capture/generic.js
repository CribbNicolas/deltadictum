// Information, not capability (spec section 7): the body must name something of
// this repository — a path, a symbol, a command, a flag or a value. Triggers do
// not make advice specific: suggested triggers always name paths, and "write
// tests" delivered on src/a.js is still generic.
const PATHLIKE = /[\w.@-]+\/[\w./@-]+|\b[\w-]+\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|cs|rb|php|ya?ml|toml|sh|ps1|sql|html|css)\b/i;
const CODE = /`[^`\s][^`]*`/;
const IDENTIFIER = /\b[a-z]+[A-Z]\w*\b|\b[A-Za-z]+_\w+\b/;
const VALUE = /\b\d+(?:\.\d+)?\s*(?:ms|s|kb|mb|gb|%|px|tokens?|characters?|bytes?|lines?|seconds?|minutes?)\b|(?:^|\s)--[a-z][\w-]+|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

export function genericReasons(memory) {
  const text = `${memory.title ?? ''}\n${memory.body ?? ''}`;
  return [PATHLIKE, CODE, IDENTIFIER, VALUE].some(pattern => pattern.test(text)) ? [] : ['generic_advice'];
}
