import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const skill of ['dd', 'dd-save', 'dd-audit']) {
  await copyFile(join(root, 'skills', skill, 'SKILL.md'), join(root, 'plugin', 'skills', skill, 'SKILL.md'));
}
console.log('Plugin skill copies synchronized from skills/.');
