// What a trial run may do without asking (claude -p --allowedTools): the project's
// own tooling, git, and the shell commands an agent uses to inspect a tree. The
// 2026-10-14 trial allowed only node, npm and git and refused 37 commands across
// the four conditions (pipes into grep or head, a cat of a module, npx eslint, a
// redirection into a log); each refusal cost a retry in every condition alike.
// Nothing here reaches outside the clone: no network, no shell, no deletion.
const PROGRAMS = ['node', 'npm', 'npx', 'git', 'cat', 'head', 'tail', 'sed', 'grep', 'rg', 'ls', 'find', 'wc', 'diff',
  'echo', 'mkdir', 'cd', 'pwd', 'sort', 'uniq', 'tr', 'cut', 'true', 'test'];

export const ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Grep', 'Glob', ...PROGRAMS.map(program => `Bash(${program}:*)`), 'mcp__dd'];
