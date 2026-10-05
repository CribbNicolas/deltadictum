# Security policy

## Supported versions

Only the latest published version of `deltadictum` receives fixes. Update with the harness's plugin
update command or `npm update -g deltadictum`.

## Reporting a vulnerability

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a
vulnerability**. Do not open a public issue for it. Include the DD version, the harness and operating
system, and the steps that reproduce it.

## What DD protects, and what it does not

The security boundary is described in the README, under
[Security boundary](docs/guide/security.md). In short: DD protects its knowledge and review from other
accounts on the machine, from web pages and from text that did not pass review. It does not protect them
from the agent itself, which runs as you and can write `.dd/` directly; review is a check on what the agent
proposes, not a lock against it. Reports in scope include:

- a way for another local account or a web page to reach the audit UI or the resident's hook API;
- text in a committed knowledge file reaching the agent without passing the content checks;
- a credential in a recognizable shape stored in knowledge or local telemetry;
- an evidence path escaping the repository, or knowledge crossing from one project to another.
