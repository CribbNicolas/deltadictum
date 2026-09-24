---
name: init
description: First deep survey of a project for DD knowledge; expensive. Use for /dd:init on a project with little or no DD knowledge.
---

# Initialize DD knowledge

Before exploring anything, tell the user: a full survey reads much of the repository and can cost a lot of model usage; for one area, `/dd:prospect <area>` is cheaper. Call `status`; if the project already has active memories, say how many. Then ask whether to continue, and stop until the user answers yes.

On a yes, survey in passes. After each pass, file what it found with `propose`, with file evidence, before starting the next:
1. Manifests, build, test and release commands, and what is not obvious about them.
2. Architecture: module boundaries, the direction of dependencies, entry points.
3. Conventions visible in code and config that a newcomer would break.
4. Decisions and their reasons: docs, ADRs, README sections, commit messages that explain a choice.
5. Traps: workarounds, TODO or FIXME with context, platform-specific code, values that look valid but are not.
6. Testing and release procedures that nothing enforces.

Before each proposal, check `similar` so nothing is filed twice. Keep only what an agent reading the code would miss. End with a summary per pass (filed, skipped) and the address from `ui`; nothing is active until the user reviews it.
