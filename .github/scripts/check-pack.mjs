// Fails unless the npm tarball carries what every host needs to run DD and
// nothing that is only for developing it. Every relative import in a shipped
// module must resolve to a shipped file, so a new directory left out of
// package.json "files" fails here rather than in a user's session.
// Usage: node .github/scripts/check-pack.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const [pack] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { encoding: 'utf8', shell: process.platform === 'win32' }));
const files = new Set(pack.files.map(file => file.path.replaceAll('\\', '/')));
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const errors = [];

const skills = [...new Set([...files].filter(path => path.startsWith('skills/')).map(path => path.split('/')[1]))];
const REQUIRED = ['package.json', 'LICENSE', 'README.md', 'npm-shrinkwrap.json', 'mcp.js', '.mcp.json',
  'hooks/hooks.json', 'hooks/run.cjs', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
  'adapters/opencode/index.js', 'adapters/opencode/frame.js', 'scripts/install-deps.mjs', 'scripts/install-codex.mjs',
  'scripts/check-codex.mjs', 'src/store/schema.sql', 'src/ui/public/index.html', 'docs/DD.md',
  ...Object.values(manifest.bin ?? {}), ...Object.values(manifest.exports ?? {}).map(path => path.replace(/^\.\//, ''))];
for (const path of REQUIRED) if (!files.has(path)) errors.push(`missing from the package: ${path}`);
if (skills.length < 8) errors.push(`expected the eight command skills, found ${skills.length}: ${skills.join(', ')}`);
for (const skill of skills) if (!files.has(`skills/${skill}/SKILL.md`)) errors.push(`skills/${skill} has no SKILL.md`);

const FORBIDDEN = [/^tests\//, /^\.dd\//, /^\.github\//, /^output\//, /^node_modules\//, /\.sqlite(-\w+)?$/, /(^|\/)\.env(\.|$)/,
  /\.log$/, /^\.dd-install\./];
for (const path of files) if (FORBIDDEN.some(pattern => pattern.test(path))) errors.push(`must not be published: ${path}`);

// npm rewrites a bin path it dislikes (a leading ./) and says so only in a warning.
for (const [name, path] of Object.entries(manifest.bin ?? {})) {
  if (path.startsWith('./')) errors.push(`bin ${name} must not start with ./ (npm drops it): ${path}`);
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|new URL\(\s*)(['"])(\.\.?\/[^'"]+)\1/g;
for (const path of files) {
  if (!/\.(m?js|cjs)$/.test(path)) continue;
  const source = readFileSync(path, 'utf8');
  for (const [, , specifier] of source.matchAll(SPECIFIER)) {
    if (specifier.includes('${')) continue;
    const target = normalize(join(dirname(path), specifier)).replaceAll('\\', '/');
    // A directory URL (new URL('..', import.meta.url)) names a place, not a file.
    if (specifier.endsWith('/') || /(^|\/)\.\.?$/.test(specifier)) continue;
    if (!files.has(target)) errors.push(`${path} refers to ${specifier}, which is not in the package`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`${pack.name}@${pack.version}: ${files.size} files, ${Math.round(pack.size / 1024)} kB packed, contents checked`);
