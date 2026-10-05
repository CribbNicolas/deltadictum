<p align="center"><img src="brand/DeltaDictum-mark.svg" width="88" alt="DeltaDictum mark"></p>

# DeltaDictum

[![CI](https://github.com/CribbNicolas/deltadictum/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/CribbNicolas/deltadictum/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/deltadictum)](https://www.npmjs.com/package/deltadictum)
[![node](https://img.shields.io/node/v/deltadictum)](package.json)
[![license](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](LICENSE)

DeltaDictum (DD) gives coding agents the engineering knowledge your code does not show:

- the decisions behind it;
- the traps you already fell into;
- the steps nothing enforces.

It recalls the right piece before the agent acts. Each memory says when it applies, what to do
differently, why, and the evidence behind it. A person reviews it before it counts.

DD is a **plugin** for Claude Code, Codex, Grok Build and OpenCode, not a service. Knowledge lives as
reviewed JSON files in your repository, retrieval runs on your machine, and nothing leaves it: no cloud
account, no model calls, no external database.

## Quickstart (Claude Code)

You need [Node.js](https://nodejs.org) 22.16 or later.

1. Install the plugin from Claude Code:

   ```text
   /plugin marketplace add CribbNicolas/deltadictum
   /plugin install dd@deltadictum
   ```

2. Start a new session in your project. Its first message gives you the **audit UI** address, where you
   review what DD learns. The first session on a machine downloads the embedding model (about 130 MB);
   until it is loaded DD says it is inactive, then it turns on by itself.
3. Give the agent a first task:

   > Use DD to orient yourself in this project. Read the README and the main architecture documents,
   > and propose the decisions and lessons worth keeping, with evidence.

4. Open the audit UI to approve, reject or send back what it proposed. From then on, the agent receives
   the memories that apply before each prompt and tool call.

For other harnesses, see [Install](#install).

## How it works

1. **Capture.** While it works, the agent proposes what an agent reading the code would miss. DD
   validates the proposal, hashes its evidence and files it as a candidate.
2. **Review.** You approve, reject or send back each candidate in the local audit UI. Candidates backed by
   evidence DD verified itself are auto-accepted by default; this is [configurable](#configuration).
3. **Recall.** Before each prompt and tool call, hooks push the memories whose keywords or meaning match,
   within a token budget, and point at near misses the agent can pull. Disputed, stale or abandoned advice
   arrives flagged, never silently.

More in [How DD works](docs/guide/how-it-works.md).

## Compatibility

| Harness | Status | Install |
|---|---|---|
| Claude Code | Tested (2.1.282) | [Plugin marketplace](#claude-code) |
| Codex | Partly tested: installer and MCP server verified; a live session with trusted hooks is not | [`deltadictum install`](#codex) |
| Grok Build | Not tested yet: install and MCP handshake checked | [Plugin marketplace](#grok-build) |
| OpenCode | Not tested yet: plugin loading checked | [`opencode.json`](#opencode) |
| Other MCP hosts | Tools only, no hooks | [Guide](docs/integrations/other-hosts.md) |

**Requirements**

- **Node.js 22.16 or later.** DD stores its index with `node:sqlite` and FTS5. On an older Node the
  session start says DD is inactive and why.
- **Operating system.**
  - Windows and Linux are tested.
  - macOS passes the test suite in CI but has not been used in a real session.
  - Alpine/musl cannot run the embedding runtime.
- **Resources.** One background process per machine, shared by every project and session:
  - about 640 MB of RAM;
  - about 610 MB of disk, including the model;
  - ports 7733-7742 on `127.0.0.1`.

  See [the resident process](docs/guide/resident.md).

## Install

### Claude Code

```text
/plugin marketplace add CribbNicolas/deltadictum
/plugin install dd@deltadictum
```

Start a new session. The `/dd:*` commands and the `dd` MCP tools are available, and the first message
names the audit UI. Claude Code installs DD's packages itself and updates the plugin from `/plugin`.

### Codex

Codex has no plugin marketplace, so DD writes the project's Codex configuration:

1. Install DD globally, so Codex points at a directory that stays:

   ```bash
   npm install -g deltadictum
   ```

2. Write the configuration into the project, then check it:

   ```bash
   deltadictum install --host codex --project "<absolute-project-path>"
   node "$(npm root -g)/deltadictum/scripts/check-codex.mjs" --project "<absolute-project-path>"
   ```

3. Open the project in Codex and trust it, then trust DD's five hooks in `/hooks`. Codex ignores a
   project's `.codex/` configuration until the project is trusted.

After `npm update -g deltadictum`, run the install command again. It refreshes DD's own settings and keeps
everything else. Commands are installed as `dd-<name>` skills. Details:
[Codex guide](docs/integrations/codex.md).

### Grok Build

```bash
grok plugin marketplace add CribbNicolas/deltadictum
grok plugin install deltadictum@deltadictum --trust
```

`--trust` is required for the hooks and the MCP server to load.

Grok copies the plugin without its packages, so the first session installs them in the background and
says DD is inactive until they are ready. Details: [Grok Build guide](docs/integrations/grok-build.md).

### OpenCode

Add DD to the project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["deltadictum"],
  "mcp": {
    "dd": {
      "type": "local",
      "command": ["npx", "-y", "deltadictum", "mcp"],
      "environment": { "DD_PROJECT_DIR": "<absolute-project-path>" },
      "enabled": true
    }
  }
}
```

OpenCode has no per-tool-call hook, so DD's context arrives once per session and recall goes through the
`dd` tools. Details: [OpenCode guide](docs/integrations/opencode.md).

## Using DD

- **The audit UI** is where knowledge is admitted. Every session start gives its address, and the agent can
  return it at any time (ask for "the DD audit link"). There you can:
  - approve, reject or send back candidates with a reason the agent receives on its next prompt;
  - apply the store changes the agent requested;
  - change the project's settings.
- **Commands** manage knowledge from the chat. Every change they make is a pending proposal or action for
  you to apply.

| Command | Does |
|---|---|
| `/dd:save` | Saves a lesson or decision from the conversation |
| `/dd:recall` | Recalls the knowledge for the current task |
| `/dd:review [id]` | Works through revision requests and memories whose evidence changed |
| `/dd:compact` | Finds memories that overlap and files merges |
| `/dd:clean` | Reviews the archive and files restores or deletions |
| `/dd:prospect <area>` | Looks for new knowledge in one area of the project |
| `/dd:init` | Deep first survey of a project; states its cost and waits for a yes |
| `/dd:audit` | Inspects knowledge, evidence and outcomes, and opens the audit UI |

On Codex the same commands are the `dd-<name>` skills. You can also ask in plain words: "save this as a
lesson", "merge these two", "that practice is dead, mark it legacy".

## Memory types

| Type | For |
|---|---|
| `lesson` (default) | A pattern learned from work: something that broke, and what to do next time |
| `decision` | An explicit project choice, with the alternatives it beat |
| `anti_memory` | A practice that must not be done; must be phrased as a prohibition |
| `procedure` | Steps to follow, in order, for a recurring task |
| `claim` | A fact about the project or its environment that the code does not show |

Each memory moves through a lifecycle: candidate, active, contested, legacy, superseded, archived or
rejected. Only active, contested (flagged) and legacy (as a warning) memories reach the agent. Fields,
states, flags and confidence: [Memories](docs/guide/memories.md).

## Configuration

Project settings live in `.dd/config.json`. DD writes it with every default on first use; commit it to
share the settings with your team. The audit UI's **Settings** panel changes auto-accept, and a hand edit
applies within seconds.

| Setting | Default | What it does |
|---|---|---|
| `auto_accept.enabled` | `true` | Admit candidates backed by evidence DD verified, without waiting for review |
| `auto_accept.confidence_threshold` | `0.765` | How strong that evidence must be; `0.765` is a repository file, diff or test log DD hashed |
| `budget_tokens` | `800` | Estimated tokens of knowledge pushed per prompt or tool call |
| `anchors.only` | `false` | Deliver a memory only when one of its keywords, files or components matches, never by similarity |

For example, to review every candidate yourself:

```json
{ "auto_accept": { "enabled": false } }
```

Machine-wide behaviour is set with environment variables. For example, `DD_EMBED_MODEL` selects the
embedding model and `DD_DATA` the local data directory. Every setting, its default and the environment
variables: [Configuration](docs/guide/configuration.md).

## Troubleshooting

When the first message says **DD is inactive**, it also says why. The usual causes:

- the model is still downloading on the first run;
- Node is older than 22.16;
- the background process cannot start.

See [When DD says it is inactive](docs/guide/resident.md#when-dd-says-it-is-inactive). Report other problems
in [issues](https://github.com/CribbNicolas/deltadictum/issues).

## Documentation

- [How DD works](docs/guide/how-it-works.md): capture, review, recall, MCP tools, commands, measurements
- [Memories](docs/guide/memories.md): types, fields, lifecycle, flags
- [Configuration](docs/guide/configuration.md): every setting and environment variable
- [The resident process](docs/guide/resident.md): the background process, its cost, troubleshooting
- [Storage](docs/guide/storage.md): what lives in `.dd/` and what stays local
- [Security boundary](docs/guide/security.md): what DD protects, and from whom
- Harness guides: [Codex](docs/integrations/codex.md), [Grok Build](docs/integrations/grok-build.md),
  [OpenCode](docs/integrations/opencode.md), [other MCP hosts](docs/integrations/other-hosts.md)
- [Behavioural contract](docs/DD.md) and [plugin constraints](docs/architecture/plugin-constraints.md)
- [Changelog](CHANGELOG.md) and [contributing](CONTRIBUTING.md)

## Security

The audit UI listens on `127.0.0.1` only, behind a per-machine key. Knowledge files that arrive through a
commit are checked before they reach the agent, and proposals carrying credentials are refused. Details:
[Security boundary](docs/guide/security.md). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## License

DD is source-available under the [PolyForm Shield License 1.0.0](LICENSE), not an open-source license.
You may install and use it for any purpose, including in paid work and inside a company, and you may
change it and share copies with the license attached. You may not sell it, offer it as a hosted or
managed service, or use it to provide any product that competes with DD. For other terms, contact the
author through the [repository](https://github.com/CribbNicolas/deltadictum).
