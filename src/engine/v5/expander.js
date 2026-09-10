import { normalizeKey } from './vocab.js';

const EMPTY = { matched: [], canonical: [], terms: [] };

export async function expandTopicTerms(projectId, text, { repository }) {
  const normalizedText = normalizeKey(text);
  if (!projectId || !normalizedText) return EMPTY;

  const occurrences = await repository.findAliasOccurrences(projectId, normalizedText);
  if (!occurrences.length) return EMPTY;

  const registryIds = [...new Set(occurrences.map(row => row.registry_id))];
  const siblings = await repository.getAliasesForRegistryIds(registryIds);

  const terms = new Set();
  for (const row of occurrences) terms.add(row.canonical_key);
  for (const sibling of siblings) terms.add(sibling.alias);

  return {
    matched: [...new Set(occurrences.map(row => row.alias))],
    canonical: [...new Set(occurrences.map(row => row.canonical_key))],
    terms: [...terms],
  };
}
