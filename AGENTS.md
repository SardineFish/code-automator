# AGENTS

Start here before changing code. This file is the stable table of contents for both humans and agents.

## Read In This Order

1. `README.md`
2. `ARCHITECTURE.md`
3. `docs/PLAN.md`
4. `docs/product-specs/index.md`
5. `docs/design-docs/index.md`
6. `docs/QUALITY_SCORE.md`
7. `docs/references/harness-engineering-notes.md`

## Working Rules

- Keep root documentation limited to `README.md`, `AGENTS.md`, and `ARCHITECTURE.md`.
- Put stable knowledge in `docs/`, not in issue comments or ad hoc notes.
- Keep stable design and product decisions in `docs/`.
- Treat the YAML service config as the source of truth for whitelist rules, executor templates, workspace settings, and trigger behavior.
- Preserve the declared layer order in `ARCHITECTURE.md`.
- Add or update an executable check in `scripts/` when you introduce a new invariant.
- Run `npm run check` before handing work off.

## Current State

- The product target is a GitHub App webhook automation service called GitHub Agent Orchestrator.
- The starter runtime is implemented in `src/` with config loading, webhook intake, trigger normalization, workflow selection, executor dispatch, and CI-backed verification.
- The current documented design is a YAML-driven workflow engine with ordered workflows such as `issue-plan`, `issue-implement`, `issue-at`, and `pr-review`.
- Workflow routing is first-match-wins. Specific command workflows must appear before generic mention handlers.

## Key Paths

- Project plan: `docs/PLAN.md`
- Product scope: `docs/product-specs/starter-scope.md`
- Design beliefs: `docs/design-docs/core-beliefs.md`
- Workflow config: `docs/design-docs/workflow-config.md`
- Harness checks: `scripts/check-docs.mjs`, `scripts/check-architecture.mjs`
