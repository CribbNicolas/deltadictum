# Security boundary

DD protects its knowledge and review from three things:

- other accounts on the machine;
- web pages;
- text that did not pass review.

It does not protect them from the agent itself. An agent running as you can read your files and write
`.dd/` directly, so review is a check on what the agent proposes, not a lock against it.

Nothing leaves the machine: no model call, hosted service or telemetry upload. The only network access is
the one-time download of the embedding model and the packages the harness installs.

## Audit UI

- **Network.** It listens on `127.0.0.1` only and refuses requests for any other `Host`, which blocks DNS
  rebinding.
- **Key.** The page and every API route require a key from the address DD prints. The first visit trades
  it for an `HttpOnly`, `SameSite=Strict` cookie.
- **Changes.** A change also needs the review token in the page and a same-origin request.
- **Scripts.** The page's script runs only under a per-response CSP nonce. Markup that an escaping mistake
  let into the page cannot execute.
- **Files.** The key and the hook token live in `~/.dd-data/resident.json`, readable only by you, like the
  local data directories. POSIX file modes enforce this; a Windows profile is already private.

## Committed knowledge

A file in `.dd/` can arrive through any commit.

- **Limits.** On read it is held to the same content limits as a proposal: size, and injection-like text.
- **Derived text.** The text injected into the agent is derived from the fields the audit UI shows, never
  taken verbatim from the file.
- **Paths.** Evidence paths must stay inside the repository.
- **Injection check.** It is a phrase list. It stops obvious instruction text, not a determined
  rewording, so human review of what enters `.dd/` remains the control.
- **Framing.** Injected knowledge is advisory content and never outranks the harness or the user. On
  OpenCode, where it lands in the system prompt, it is framed that way explicitly.

## Credentials

A proposal carrying a credential in a recognizable shape is refused, since knowledge is committed and
shared. That covers cloud, Git host, npm, Slack and Stripe keys, JWTs, bearer tokens and private keys.
Observations and feedback are redacted before they are stored.

## Packages

The published package ships `npm-shrinkwrap.json`, so npm installs the exact reviewed dependency tree.
The first-run installer for harnesses that copy the plugin without its packages runs
`npm ci --ignore-scripts`. Releases are published from CI with npm provenance.

To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
