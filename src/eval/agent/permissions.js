// What a trial run may do without asking (claude -p --allowedTools). The
// 2026-10-14 trial allowed node, npm and git and refused 37 commands across the
// four conditions (pipes into grep or head, a cat of a module, npx eslint, a
// redirection into a log); each refusal cost a retry in every condition alike.
//
// What this list is and is not: it only says which commands the host runs
// without a permission prompt. node, npm and git could already run arbitrary code
// and reach the network before it (node -e, npm install, git fetch); the suite,
// lint and the checks need them, so the trial trusts the model inside its fresh
// clone, as it always did. The widening adds read-only inspection commands,
// writes inside the clone (sed -i, mkdir) and the one npx invocation the agents
// used, never a bare npx (it fetches and runs any package) or find (-exec,
// -delete). The isolation this list does not give is a container or VM without
// host credentials; run the trial there when the model is not trusted.
const PROGRAMS = ['node', 'npm', 'git', 'cat', 'head', 'tail', 'sed', 'grep', 'rg', 'ls', 'wc', 'diff', 'echo', 'mkdir', 'cd', 'pwd',
  'sort', 'uniq', 'tr', 'cut', 'true', 'test'];
const INVOCATIONS = ['npx eslint'];

// A bench project on another stack adds its own tool chain (go, python, dotnet).
export const allowedTools = (programs = []) => ['Read', 'Edit', 'Write', 'Grep', 'Glob',
  ...[...new Set([...PROGRAMS, ...programs]), ...INVOCATIONS].map(program => `Bash(${program}:*)`), 'mcp__dd'];

export const ALLOWED_TOOLS = allowedTools();
