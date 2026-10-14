# Security boundary

DD protects a project's knowledge and its review from other accounts on the machine, from web pages and
from text that did not pass validation. It does not protect them from the agent itself, which runs as you
and can write `.dd/` directly: review is a check on what the agent proposes, not a lock against it.

## Review UI

`deltadictum ui` serves one project on a loopback address until it is stopped.

- It answers only requests whose `Host` is its own address, so a web page cannot reach it through DNS
  rebinding.
- It answers only a browser holding the key printed with its address, traded once for an `HttpOnly`,
  `SameSite=Strict` cookie.
- It accepts changes only as JSON, which a cross-site form cannot send.
- Its page runs only scripts carrying the page's nonce, and inserts every stored text as text, never as
  markup.

## Memories

- Every memory is validated before it is written or compiled: schema, sizes, safe repository-relative paths
  and globs, and no credential in a recognizable shape or unsafe content.
- Evidence paths cannot leave the repository, and no memory reaches another project.
- Delivered memories are framed as advisory project knowledge; they never outrank the host, the user or
  the current code.

## Checks

A check is two regular expressions and never runs code. Patterns that can backtrack catastrophically are
refused, and every evaluation runs under a time limit.

## Hooks and data

A hook that fails ends silently and never blocks the host. DD makes no network request; everything it
derives stays in `.dd/local/`, out of git.
