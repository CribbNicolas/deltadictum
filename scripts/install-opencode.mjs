#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyCodexInstall, ephemeralRoot, optionalText, planShared } from './install-codex.mjs';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const slash = path => path.replaceAll('\\', '/');

// OpenCode loads a plugin named in the project's opencode.json, and its skills from .opencode/skills/:
// skills under .agents/ are read only from the home folder. The plugin entry names the adapter of the DD
// running the install, as the Codex hooks name its directory; an entry DD wrote before (the npm name, or
// any copy of the adapter) is replaced, and every other plugin and key is kept.
export async function planOpencodeInstall(project, { root = pluginRoot } = {}) {
  if (ephemeralRoot(root)) throw new Error(`ephemeral_install: DD is running from the npx cache (${slash(root)}), which npm may clear, and OpenCode would keep pointing at it. Install it globally, then run the installer from there: npm install -g deltadictum && deltadictum install --host opencode --project PROJECT`);
  const projectRoot = await realpath(resolve(project));
  const operations = [];
  async function plan(path, content, before = undefined) {
    before ??= await optionalText(path);
    if (before !== content) operations.push({ path, before, content });
  }
  if (await optionalText(join(projectRoot, 'opencode.jsonc'))) {
    throw new Error('opencode_jsonc: this project configures OpenCode in opencode.jsonc; add the plugin there by hand (see Getting started)');
  }
  const configPath = join(projectRoot, 'opencode.json');
  const configText = await optionalText(configPath);
  const config = configText ? JSON.parse(configText) : { $schema: 'https://opencode.ai/config.json' };
  const adapter = pathToFileURL(join(root, 'adapters', 'opencode', 'index.js')).href;
  const owned = entry => typeof entry === 'string' && (entry === 'deltadictum' || entry.startsWith('deltadictum@') || /adapters\/opencode\/index\.js$/.test(slash(entry)));
  config.plugin = [...(Array.isArray(config.plugin) ? config.plugin : []).filter(entry => !owned(entry)), adapter];
  await plan(configPath, `${JSON.stringify(config, null, 2)}\n`, configText);
  await planShared({ projectRoot, root, plan, skillsDir: join(projectRoot, '.opencode', 'skills'), saveWith: 'the dd-save skill' });
  return { projectRoot, pluginRoot: root, dataDir: join(projectRoot, '.dd', 'local'), operations };
}

// The same preflight and writes as the Codex install.
export const applyOpencodeInstall = applyCodexInstall;
