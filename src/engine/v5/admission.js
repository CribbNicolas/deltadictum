import { resolveKey } from './resolver.js';
import { validateAgainstVocabulary } from './vocab.js';

export async function prepareV5Write(payload = {}, { repository }) {
  const vocab = await repository.getVocabulary(payload.project_id);
  const resolved = await resolveKey(payload.project_id, payload.topic_key, { repository });

  if (resolved.found && resolved.status === 'deprecated') {
    return { error: { code: 422, message: 'topic_key_deprecated', notes: resolved.notes ?? null } };
  }

  const candidateKey = resolved.found ? resolved.canonical_key : payload.topic_key;
  const check = validateAgainstVocabulary(candidateKey, payload.tags, vocab);
  if (!check.valid) {
    return { error: { code: 422, message: check.reason } };
  }

  return {
    error: null,
    payload: { ...payload, topic_key: check.normalized },
    registry_key_id: resolved.found ? resolved.registry_id : null,
    needs_registration: !resolved.found,
  };
}
