---
title: Grok Build
description: "Running DeltaDictum in Grok Build: how to install it, what works, and why it is not verified yet."
parent: Harnesses
nav_order: 3
---

# Grok Build

**Status: not verified.** DD's Grok plugin runs the hooks Claude Code runs, assuming Claude Code's payload
shape; Grok's real payloads have not been recorded yet, so a tool name Grok spells differently fires
nothing. Grok Build is verified after Codex.

## Install

```bash
grok plugin marketplace add CribbNicolas/deltadictum
grok plugin install deltadictum@deltadictum --trust
```

`--trust` is required for the hooks to load. The plugin is described by `.grok-plugin/plugin.json` and
`.grok-plugin/marketplace.json` at the repository root (`${GROK_PLUGIN_ROOT}` in place of
`${CLAUDE_PLUGIN_ROOT}`). DD has no packages to install.

Inside this checkout, `.grok/hooks/dd.json` registers the same hooks as a project-level Grok configuration.

## Recording payloads

To record what Grok sends, run a session with `DD_CAPTURE_PAYLOADS` set to a file: every hook appends its
command and payload to it.
