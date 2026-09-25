// Fails unless the package version is strictly greater than the base branch's
// and every manifest that carries a version agrees with package.json.
// Usage: node .github/scripts/check-version.mjs <base-ref>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MANIFESTS = ['package.json', '.claude-plugin/plugin.json'];
const baseRef = process.argv[2] ?? 'origin/main';

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!match) throw new Error(`not a MAJOR.MINOR.PATCH version: ${version}`);
  return match.slice(1).map(Number);
}

function greater(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const errors = [];
const head = JSON.parse(readFileSync('package.json', 'utf8')).version;

for (const file of MANIFESTS.slice(1)) {
  const version = JSON.parse(readFileSync(file, 'utf8')).version;
  if (version !== head) errors.push(`${file} has ${version}, package.json has ${head}`);
}

const baseJson = execFileSync('git', ['show', `${baseRef}:package.json`], { encoding: 'utf8' });
const base = JSON.parse(baseJson).version;
try {
  if (!greater(parse(head), parse(base))) errors.push(`version ${head} must be greater than ${baseRef} (${base})`);
} catch (error) {
  errors.push(error.message);
}

if (errors.length) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`version ${base} -> ${head}`);
