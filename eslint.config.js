// Correctness rules only, no style: an undefined name or an unused binding is a
// bug or dead code (a `status` command that referenced two undefined variables
// shipped in 0.8.2). ESLint is run through npx (`npm run lint`) rather than
// installed: a devDependency would land in every host that installs the plugin
// with a plain `npm ci`, and the config imports nothing for the same reason.
const NODE_GLOBALS = ['process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'URL', 'URLSearchParams', 'fetch', 'AbortSignal', 'AbortController', 'TextEncoder',
  'TextDecoder', 'structuredClone', 'performance', 'queueMicrotask', 'globalThis', 'Response', 'Request', 'Headers'];
const globals = Object.fromEntries(NODE_GLOBALS.map(name => [name, 'readonly']));

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-dupe-else-if': 'error',
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-redeclare': 'error',
  'no-unsafe-finally': 'error',
  'no-fallthrough': 'error',
  'no-empty-pattern': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

export default [
  { ignores: ['node_modules/**', 'output/**', '.dd/**'] },
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals }, rules },
  { files: ['**/*.cjs'], rules,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs',
      globals: { ...globals, require: 'readonly', module: 'writable', exports: 'writable', __dirname: 'readonly', __filename: 'readonly' } } },
];
