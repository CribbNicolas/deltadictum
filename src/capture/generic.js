// Information, not capability (spec section 7): the body must name something of
// this repository — a path, a symbol, a command, a flag or a value. Triggers do
// not make advice specific: suggested triggers always name paths, and "write
// tests" delivered on src/a.js is still generic. With the repository at hand, a
// named path or symbol counts only if the repository has it.
const PATHLIKE = /[\w.@-]+\/(?:[\w./@-]+|(?=[\s.,;:)]|$))|\b[\w-]+\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|cs|rb|php|ya?ml|toml|sh|ps1|sql|html|css)\b/gi;
const CODE = /`([^`\s][^`]*)`/g;
const IDENTIFIER = /\b[a-z]+[A-Z]\w*\b|\b[A-Za-z]+_\w+\b/g;
const VALUE = /\b\d+(?:\.\d+)?\s*(?:ms|s|kb|mb|gb|%|px|tokens?|characters?|bytes?|lines?|seconds?|minutes?)\b|(?:^|\s)--[a-z][\w-]+|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

// The paths and symbols a body names, for the caller to look up in the repository.
export function namedSymbols(memory) {
  const text = `${memory.title ?? ''}\n${memory.body ?? ''}`;
  return [...new Set([...(text.match(IDENTIFIER) ?? []), ...[...text.matchAll(CODE)].map(match => match[1].trim())])];
}

export function genericReasons(memory, { repoFiles = null, symbolExists = null } = {}) {
  const text = `${memory.title ?? ''}\n${memory.body ?? ''}`;
  if (VALUE.test(text)) return [];
  const paths = (text.match(PATHLIKE) ?? []).map(path => path.replace(/^\.\//, ''));
  const pathExists = path => !repoFiles || repoFiles.some(file => file === path || file.startsWith(`${path.replace(/\/$/, '')}/`));
  const symbolKnown = name => !symbolExists || symbolExists(name) || pathExists(name);
  return paths.some(pathExists) || namedSymbols(memory).some(symbolKnown) ? [] : ['generic_advice'];
}
