---
title: Commands
description: "Every DeltaDictum command: the ones you give in the session, by harness, and the deltadictum command line."
nav_order: 4
has_children: true
---

# Commands

## In the session

<!-- for: claude-code -->

| Command | Does |
|---|---|
| `/dd:save` | Saves knowledge from the conversation as a memory, or asks for a change to one |
| `/dd:recall <topic>` | Shows what DD knows on a topic (`deltadictum recall`) |
| `/dd:review` | Runs doctor, then opens the review UI and prints its address |

The prefix is the plugin's name, `dd`.

<!-- /for -->

<!-- for: codex -->

| Skill | Does |
|---|---|
| `dd-save` | Saves knowledge from the conversation as a memory, or asks for a change to one |
| `dd-recall` | Shows what DD knows on a topic (`deltadictum recall`) |
| `dd-review` | Runs doctor, then opens the review UI and prints its address |

`deltadictum install --host codex` writes them into `.agents/skills/`; ask the agent for one by name.

<!-- /for -->

<!-- for: grok -->

| Skill | Does |
|---|---|
| `save` | Saves knowledge from the conversation as a memory, or asks for a change to one |
| `recall` | Shows what DD knows on a topic (`deltadictum recall`) |
| `review` | Runs doctor, then opens the review UI and prints its address |

They come with the `deltadictum` plugin; ask the agent for one by name.

<!-- /for -->

<!-- for: opencode -->

OpenCode has no DD commands. Ask the agent in words ("save this as a trap: …") and use the command line
below for the rest.

<!-- /for -->

Saying it in words works everywhere too: "save this as a decision", "what does DD know about the store?".

## Command line

Run from the project's root, as `npx deltadictum <command>` or, installed globally, `deltadictum <command>`.

| Command | Does |
|---|---|
| `init [--project-id NAME]` | Opts the project in: writes `.dd/config.json`, `.dd/.gitignore` and `.dd/memories/`, and compiles |
| `doctor` | Is DD working here: Node, the opt-in, the index, sessions recorded, maintenance, what needs a person; exit 1 on a problem |
| `status` | Memory counts by status, and topics with more than one live memory |
| `health` | Each memory's health: dead triggers, idle, hubs, stale evidence, false alarms; the capture funnel |
| `recall QUERY [--all] [--limit N]` | Prints the memories that match, in full (`--all` includes candidates) |
| `ui [--port N]` | The review UI, until interrupted (default port 7733; a busy port falls back to a free one) |
| `compile` | Rebuilds the index by hand (session start does it when the memories changed) |
| `maintain` | The daily maintenance, by hand |
| `import [--from DIR] [--dry-run]` | Turns `.claude/rules/` and `.cursor/rules/` files that name paths into memories; a second run updates the ones that changed |
| `install --host codex --project PATH [--dry-run]` | Writes DD's Codex configuration into a project |
| `help`, `version` | The command list; the installed version |
