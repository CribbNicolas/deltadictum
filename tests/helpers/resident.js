import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRegistry } from '../../src/resident.js';

// Tests register their resident in a temporary registry, never the machine's
// real one (~/.dd-data/resident.json). Hook processes they spawn inherit it.
export async function useTempRegistry(t) {
  const previous = process.env.DD_RESIDENT_REGISTRY;
  process.env.DD_RESIDENT_REGISTRY = join(await mkdtemp(join(tmpdir(), 'dd-registry-')), 'resident.json');
  t?.after(() => { if (previous === undefined) delete process.env.DD_RESIDENT_REGISTRY; else process.env.DD_RESIDENT_REGISTRY = previous; });
  return process.env.DD_RESIDENT_REGISTRY;
}

export async function registerResident(t, ui) {
  if (!process.env.DD_RESIDENT_REGISTRY?.includes('dd-registry-')) await useTempRegistry(t);
  await writeRegistry(ui);
}
