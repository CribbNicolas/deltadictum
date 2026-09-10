import { normalizeKey } from './vocab.js';

export async function resolveKey(projectId, key, { repository }) {
  const normalized = normalizeKey(key);
  if (!projectId || !normalized) return { found: false };

  const direct = await repository.getRegistryEntryByKey(projectId, normalized);
  if (direct) {
    const aliases = await repository.getAliasesForRegistry(direct.id);
    return {
      found: true,
      registry_id: direct.id,
      canonical_key: direct.canonical_key,
      status: direct.status,
      notes: direct.notes ?? null,
      aliases,
      via: 'canonical',
    };
  }

  const aliasRow = await repository.getAliasByName(projectId, normalized);
  if (aliasRow) {
    const target = await repository.getRegistryEntryById(aliasRow.registry_id);
    if (!target) return { found: false };
    const aliases = await repository.getAliasesForRegistry(target.id);
    return {
      found: true,
      registry_id: target.id,
      canonical_key: target.canonical_key,
      status: target.status,
      notes: target.notes ?? null,
      aliases,
      via: 'alias',
    };
  }

  return { found: false };
}
