import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { VERIFIED_OBSERVATION_PROVENANCES } from './reliability.js';

export async function projectFile(repoRoot, ref) {
  const clean = String(ref ?? '').replace(/#L\d+(?:-L?\d+)?$/, '');
  if (!clean || isAbsolute(clean) || clean.includes(':') || clean.split(/[\\/]/).includes('..')) throw new Error('evidence_scope_violation');
  const root = await realpath(repoRoot);
  const path = await realpath(resolve(root, clean));
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('evidence_scope_violation');
  const info = await stat(path);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('evidence_file_too_large');
  return path;
}

export async function verifyReferences(refs, { store, repoRoot = store.repoRoot, projectId } = {}) {
  const artifacts = [];
  for (const ref of refs ?? []) {
    const entry = { source_type: ref.source_type, source_ref: ref.source_ref, summary: ref.summary,
      status: 'unverified', provenance: 'agent_claim' };
    if (ref.source_type === 'file' || ref.source_type === 'diff' || ref.source_type === 'test_log') {
      try {
        const path = await projectFile(repoRoot, ref.source_ref);
        entry.hash = createHash('sha256').update(await readFile(path)).digest('hex');
        entry.status = 'verified'; entry.provenance = 'filesystem';
      } catch (err) {
        entry.status = err.message === 'evidence_scope_violation' ? 'out_of_scope' : 'unavailable';
      }
    } else if (ref.source_type === 'tool_output' && store.getObservation) {
      const observation = await store.getObservation(ref.source_ref);
      // Which observation provenances verify is the reliability ladder's business,
      // not a second list kept here. Observation provenance is stamped by the hook
      // and the engine; a proposal cannot supply it.
      if (VERIFIED_OBSERVATION_PROVENANCES.includes(observation?.metadata?.provenance) && observation.project_id === projectId) {
        entry.status = 'verified'; entry.provenance = observation.metadata.provenance;
        entry.hash = createHash('sha256').update(observation.raw_preview).digest('hex');
      }
    }
    artifacts.push(entry);
  }
  return { checked_at: new Date().toISOString(), artifacts,
    verified_count: artifacts.filter(a => a.status === 'verified').length,
    // Existence/integrity is not logical entailment. Only review can establish support.
    support: 'unreviewed' };
}

// A stat()-gated fast path in front of the real read+hash: reused only when a
// cached row's mtime AND size both still match the file on disk. Known gap,
// deliberately accepted rather than hidden: a file rewritten with identical
// size inside the same filesystem mtime-resolution tick would not be caught
// until its mtime actually advances. The cache is store-derived only (never
// written into the atom's own evidence_state/git file, per the anti_memory
// against git-authoritative telemetry) and a cache-layer failure always falls
// back to the unconditional read+hash rather than skipping the check.
async function hashWithCache(path, atomId, sourceRef, store) {
  const stats = await stat(path);
  let cached = null;
  try { cached = store?.index?.getEvidenceFreshness?.(atomId, sourceRef) ?? null; } catch { cached = null; }
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.hash;
  const hash = createHash('sha256').update(await readFile(path)).digest('hex');
  try { store?.index?.setEvidenceFreshness?.(atomId, sourceRef, { mtimeMs: stats.mtimeMs, size: stats.size, hash }); }
  catch { /* best-effort cache write; the next check just re-hashes */ }
  return hash;
}

export async function checkEvidenceFreshness(atom, store) {
  const reasons = [];
  for (const artifact of atom.evidence_state?.artifacts ?? []) {
    if (artifact.provenance !== 'filesystem' || !artifact.hash) continue;
    try {
      const path = await projectFile(store.repoRoot, artifact.source_ref);
      const hash = await hashWithCache(path, atom.id, artifact.source_ref, store);
      if (hash !== artifact.hash) reasons.push(`evidence_changed:${artifact.source_ref}`);
    } catch { reasons.push(`evidence_unavailable:${artifact.source_ref}`); }
  }
  for (const rule of atom.revisit_when ?? []) {
    if (rule.kind !== 'file_changed') continue;
    try {
      const path = await projectFile(store.repoRoot, rule.path);
      const hash = await hashWithCache(path, atom.id, rule.path, store);
      if (!rule.hash || hash !== rule.hash) reasons.push(`revision_file_changed:${rule.path}`);
    } catch { reasons.push(`revision_file_unavailable:${rule.path}`); }
  }
  return reasons;
}

export async function stampRevisionFiles(atom, store) {
  for (const rule of atom.revisit_when ?? []) {
    if (rule.kind !== 'file_changed') continue;
    try { rule.hash = createHash('sha256').update(await readFile(await projectFile(store.repoRoot, rule.path))).digest('hex'); }
    catch { rule.hash = null; }
  }
  return atom;
}
