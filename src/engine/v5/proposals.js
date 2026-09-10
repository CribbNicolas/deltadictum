import { normalizeKey, validateKeyFormat } from './vocab.js';

const VOCAB_VALUE_PATTERN = /^[a-z0-9_-]+$/;

export async function gateProposal(proposal = {}, { repository }) {
  const { project_id, proposal_type, payload = {} } = proposal;
  if (!project_id) return { status: 'rejected', reason: 'missing_project_id' };

  switch (proposal_type) {
    case 'new_key': {
      const fmt = validateKeyFormat(payload.key);
      if (!fmt.valid) return { status: 'rejected', reason: fmt.reason };
      if (await repository.getRegistryEntryByKey(project_id, fmt.normalized)) {
        return { status: 'rejected', reason: 'key_exists' };
      }
      if (await repository.getAliasByName(project_id, fmt.normalized)) {
        return { status: 'rejected', reason: 'key_collides_with_alias' };
      }
      return { status: 'auto_approved' };
    }
    case 'alias_add': {
      const fmt = validateKeyFormat(payload.alias);
      if (!fmt.valid) return { status: 'rejected', reason: fmt.reason };
      const target = await repository.getRegistryEntryByKey(project_id, normalizeKey(payload.target_key));
      if (!target) return { status: 'rejected', reason: 'unknown_target' };
      if (await repository.getAliasByName(project_id, fmt.normalized)
        || await repository.getRegistryEntryByKey(project_id, fmt.normalized)) {
        return { status: 'rejected', reason: 'alias_collision' };
      }
      return target.status === 'canonical' ? { status: 'pending' } : { status: 'auto_approved' };
    }
    case 'vocab_add': {
      if (!['domain', 'tag'].includes(payload.kind)) return { status: 'rejected', reason: 'invalid_vocab_kind' };
      if (!VOCAB_VALUE_PATTERN.test(String(payload.value ?? ''))) return { status: 'rejected', reason: 'invalid_vocab_value' };
      if (await repository.getVocabularyValue(project_id, payload.kind, payload.value)) {
        return { status: 'rejected', reason: 'vocab_exists' };
      }
      return payload.kind === 'tag' ? { status: 'auto_approved' } : { status: 'pending' };
    }
    case 'promote':
    case 'deprecate': {
      const target = await repository.getRegistryEntryByKey(project_id, normalizeKey(payload.target_key));
      if (!target) return { status: 'rejected', reason: 'unknown_target' };
      return { status: 'pending' };
    }
    case 'rename': {
      const target = await repository.getRegistryEntryByKey(project_id, normalizeKey(payload.target_key));
      if (!target) return { status: 'rejected', reason: 'unknown_target' };
      const fmt = validateKeyFormat(payload.new_key);
      if (!fmt.valid) return { status: 'rejected', reason: fmt.reason };
      if (await repository.getRegistryEntryByKey(project_id, fmt.normalized)
        || await repository.getAliasByName(project_id, fmt.normalized)) {
        return { status: 'rejected', reason: 'key_collision' };
      }
      return { status: 'pending' };
    }
    default:
      return { status: 'rejected', reason: 'invalid_proposal_type' };
  }
}

export async function applyProposal(proposal = {}, { repository }) {
  const { project_id, proposal_type, payload = {} } = proposal;
  switch (proposal_type) {
    case 'new_key':
      return repository.createRegistryEntry(project_id, normalizeKey(payload.key), 'provisional');
    case 'alias_add': {
      const target = await repository.getRegistryEntryByKey(project_id, normalizeKey(payload.target_key));
      return repository.createAlias(target.id, project_id, normalizeKey(payload.alias), payload.kind ?? 'alias', payload.lang ?? null);
    }
    case 'vocab_add':
      return repository.createVocabularyValue(project_id, payload.kind, payload.value);
    case 'promote':
      return repository.updateRegistryStatus(project_id, normalizeKey(payload.target_key), 'canonical');
    case 'deprecate':
      return repository.updateRegistryStatus(project_id, normalizeKey(payload.target_key), 'deprecated');
    case 'rename': {
      const target = await repository.getRegistryEntryByKey(project_id, normalizeKey(payload.target_key));
      await repository.renameRegistryEntry(target.id, normalizeKey(payload.new_key));
      await repository.createAlias(target.id, project_id, target.canonical_key, 'rename', null);
      return target;
    }
    default:
      throw new Error(`unsupported proposal_type: ${proposal_type}`);
  }
}
