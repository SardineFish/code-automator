# Quality Score

This file tracks the repo as it moves from the starter scaffold toward GitHub Agent Orchestrator.

| Area | Current State | Evidence |
| --- | --- | --- |
| Docs map | Green | `README.md`, `AGENTS.md`, product specs, and design docs now describe the same YAML-driven workflow model |
| Architecture guidance | Green | `ARCHITECTURE.md` |
| Verification loop | Green | `npm run check` validates docs, TypeScript build, and tests |
| Product runtime | Red | `src/` contains a TypeScript placeholder app rather than webhook automation code |
| Generated knowledge | Yellow | No generated docs or code indexes yet |

## Next Up

- Replace the TypeScript placeholder app with the first webhook intake, config loading, and workflow-matching slice under `src/`.
- Add product-specific checks for YAML config, trigger normalization, and workflow precedence invariants.
- Add a CI workflow once runtime implementation begins.
