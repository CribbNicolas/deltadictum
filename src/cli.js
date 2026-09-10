#!/usr/bin/env node
import { openStore } from './project.js';
import { startUiServer } from './ui/server.js';

const [command] = process.argv.slice(2);

async function main() {
  const { store, projectId, ddDir, dataDir } = await openStore();
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
  console.log(`DD - UI ${ui.url}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
