# Quality Score

This file tracks the repo as it moves from the starter scaffold toward GitHub Agent Orchestrator.

| Area | Current State | Evidence |
| --- | --- | --- |
| Docs map | Green | `README.md`, `AGENTS.md`, product specs, and design docs now describe the same YAML-driven workflow model |
| Architecture guidance | Green | `ARCHITECTURE.md` and `scripts/check-architecture.mjs` |
| Verification loop | Yellow | `npm run check` and `node --test` exist, but product-specific checks and product tests do not yet exist |
| Planning discipline | Green | Active execution plan under `docs/exec-plans/active/` |
| Product runtime | Red | Placeholder source has been removed from `src/`, but webhook automation code has not been implemented |
| Generated knowledge | Yellow | No generated docs or code indexes yet |

## Next Up

- Add the first webhook intake, config loading, and workflow-matching slice under `src/`.
- Add product-specific checks for YAML config, trigger normalization, and workflow precedence invariants.
- Add a CI workflow once runtime implementation begins.
