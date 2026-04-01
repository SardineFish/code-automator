# Project Plan

This file defines the implementation order for the whole GitHub Agent Orchestrator project.

## Commit Rule

- One commit should implement one numbered plan below.
- Do not combine multiple plans in a single commit, even when the changes are small.
- If a plan is too large for one clean commit, split that plan into smaller child tasks before coding.
- Every plan should land with tests or executable checks for the invariants it introduces.

## Sequencing Rule

- Follow the repository layer order from `ARCHITECTURE.md`: `types`, `config`, `repo`, `service`, `runtime`, `ui`.
- Build stable contracts before provider code and runtime wiring.
- Preserve YAML declaration order and first-match-wins workflow behavior from the start.

## Plans

### Plan 1: Core config typing

- Deliver stable TypeScript types for `clientId`, `workspace`, `whitelist`, `executors`, `workflow`, trigger keys, and normalized workflow input.
- Keep this plan limited to types and small test fixtures.
- Exit when the documented YAML contract can be expressed without `any` or ad hoc string literals.

### Plan 2: YAML config loading and validation

- Load one YAML config file, preserve workflow declaration order, and validate required keys and value shapes.
- Produce actionable validation errors that point to the broken section.
- Keep templating, execution, and webhook handling out of this plan.

### Plan 3: Template string renderer and variable system

- Implement the shared renderer for `${in.*}`, `${prompt}`, and `${workspace}`.
- Define explicit variable maps and failure behavior for missing or unsupported variables.
- Keep process spawning and GitHub event handling out of this plan.

### Plan 4: Execution engine

- Build executor command preparation, environment merging, workspace creation, and cleanup behavior.
- Put child-process execution behind a provider boundary so it can be tested without running real agents.
- Return structured run results that later plans can log and react to.

### Plan 5: Webhook server

- Add the HTTP entrypoint, request parsing, signature verification hook, and basic response model.
- Verify `clientId` and installation context at the edge before runtime dispatch.
- Enforce `whitelist.user` and `whitelist.repo` at the edge so disallowed requests stop before trigger selection.
- Keep trigger matching stubbed or minimal here; this plan is about intake and safe request boundaries.

### Plan 6: Trigger normalization

- Convert supported GitHub webhook payloads into canonical triggers and normalized inputs such as `issueId`, `prId`, `repo`, and `content`.
- Cover command alias handling for `plan`, `approve`, `go`, `implement`, and `code`.

### Plan 7: Trigger-workflow engine

- Evaluate workflows in YAML order, apply first-match-wins, and resolve the selected executor plus rendered prompt.
- Make precedence bugs hard to reintroduce with focused tests and checks.
- Keep this plan centered on deterministic selection, not on HTTP or process details.

### Plan 8: Application wiring

- Replace the placeholder app with the real orchestration path from webhook intake to normalized event to workflow selection to execution.
- Add structured logging and result translation so operators can see why a webhook was ignored, matched, or failed.
- Keep startup configuration explicit in `src/app/` and avoid hidden global state.

### Plan 9: Runtime hardening

- Tighten failure handling, timeouts, cleanup guarantees, and operator-facing error messages.
- Add checks for config drift, workflow precedence regressions, and workspace lifecycle invariants.
- Review package name, startup docs, and service configuration so the repository no longer looks like a scaffold.

### Plan 10: End-to-end verification and release readiness

- Add fixture-driven integration tests for the documented workflows: `issue-plan`, `issue-implement`, `issue-at`, and `pr-review`.
- Add CI automation for `npm run check` and any new product-specific checks.
- Document the production bootstrap path, config example, and deployment assumptions once the runtime is complete.

## Definition Of Done For Each Plan

- Code follows the declared architecture layers.
- `npm run check` passes.
- Docs and checks that define the new invariant land in the same plan.
- The next numbered plan can start without needing to backfill missing foundations from the current one.
