#!/usr/bin/env node
import { openStore } from './project.js';
import { startUiServer } from './ui/server.js';
import { orientProject } from './engine/project-context.js';
import { writeUiUrl } from './hooks/banner.js';

const [command] = process.argv.slice(2);

async function main() {
  const { store, projectId, ddDir, dataDir } = await openStore();
  if (command === 'orient') {
    console.log(JSON.stringify(await orientProject({ action: process.argv.slice(3).join(' ') || undefined }, { store, projectId })));
    store.close(); return;
  }
  if (command === 'maintain') {
    await store.prune();
    console.log('Local observations and telemetry pruned to configured retention limits.');
    store.close(); return;
  }
  if (command === 'reindex') {
    const result = await store.reindex();
    console.log(`reindexed ${result.atoms} atoms`);
    store.close();
    return;
  }
  if (command === 'status') {
    const { counts, total } = await store.countByLifecycle(projectId);
    console.log(JSON.stringify({
      project_id: projectId,
      ddDir,
      dataDir,
      total,
      by_state: counts,
    }, null, 2));
    store.close();
    return;
  }
  if (command === 'health') {
    const report = await store.assessDeterioration(projectId);
    console.log(JSON.stringify(report, null, 2));
    store.close();
    return;
  }
  const ui = await startUiServer({ store, projectId });
  await writeUiUrl(ddDir, ui);
  console.log(`DD - UI ${ui.url}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
