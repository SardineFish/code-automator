# Project Plan

This file defines the implementation order for the whole Coding Automator project.

## Commit Rule

- One commit should implement one numbered plan below.
- Do not combine multiple plans in a single commit, even when the changes are small.
- If a plan is too large for one clean commit, split that plan into smaller child tasks before coding.
- Every plan should land with tests or executable checks for the invariants it introduces.
- Treat each plan commit as an explicit version-control checkpoint so the repo can be reviewed, bisected, reverted, or rolled back at that exact product step.

## Sequencing Rule

- Follow the repository layer order from `ARCHITECTURE.md`: `types`, `config`, `repo`, `service`, `runtime`, `ui`.
- Build stable contracts before provider code and runtime wiring.
- Preserve YAML declaration order and first-match-wins workflow behavior from the start.

## Plans

### Plan 1: Core config typing [done]

- Deliver stable TypeScript types for `clientId`, `workspace`, `whitelist`, `executors`, `workflow`, trigger keys, and normalized workflow input.
- Keep this plan limited to types and small test fixtures.
- Exit when the documented YAML contract can be expressed without `any` or ad hoc string literals.

### Plan 2: YAML config loading and validation [done]

- Load one YAML config file, preserve workflow declaration order, and validate required keys and value shapes.
- Produce actionable validation errors that point to the broken section.
- Keep templating, execution, and webhook handling out of this plan.

### Plan 3: Template string renderer and variable system [done]

- Implement the shared renderer for `${in.*}`, `${prompt}`, and `${workspace}`.
- Define explicit variable maps and failure behavior for missing or unsupported variables.
- Keep process spawning and GitHub event handling out of this plan.

### Plan 4: Execution engine [done]

- Build executor command preparation, environment merging, workspace creation, and cleanup behavior.
- Put child-process execution behind a provider boundary so it can be tested without running real agents.
- Return structured run results that later plans can log and react to.

### Plan 5: Webhook server [done]

- Add the HTTP entrypoint, request parsing, signature verification hook, and basic response model.
- Verify webhook signature and installation context at the edge before runtime dispatch.
- Enforce `whitelist.user` and `whitelist.repo` at the edge so disallowed requests stop before trigger selection.
- Keep trigger matching stubbed or minimal here; this plan is about intake and safe request boundaries.

### Plan 6: Trigger normalization [done]

- Convert supported GitHub webhook payloads into canonical triggers and normalized inputs that include both structured fields and simple aliases such as `subjectNumber`, `prNumber`, `repo`, and `content`.
- Cover command alias handling for `plan`, `approve`, `go`, `implement`, and `code`.

### Plan 7: Trigger-workflow engine [done]

- Evaluate workflows in YAML order, apply first-match-wins, and resolve the selected executor plus rendered prompt.
- Make precedence bugs hard to reintroduce with focused tests and checks.
- Keep this plan centered on deterministic selection, not on HTTP or process details.

### Plan 8: Application wiring [done]

- Replace the placeholder app with the real orchestration path from webhook intake to normalized event to workflow selection to execution.
- Add structured logging and result translation so operators can see why a webhook was ignored, matched, or failed.
- Keep startup configuration explicit in `src/app/` and avoid hidden global state.

### Plan 9: Runtime hardening [done]

- Tighten failure handling, timeouts, cleanup guarantees, and operator-facing error messages.
- Add checks for config drift, workflow precedence regressions, and workspace lifecycle invariants.
- Review package name, startup docs, and service configuration so the repository no longer looks like a scaffold.

### Plan 10: End-to-end verification and release readiness [done]

- Add fixture-driven integration tests for the documented workflows: `issue-plan`, `issue-implement`, `issue-at`, and `pr-review`.
- Add CI automation for `npm run check` and any new product-specific checks.
- Document the production bootstrap path, config example, and deployment assumptions once the runtime is complete.

### Plan 11: Provider-extensible ingress docs and contract reset [done]

- Update the public docs to describe the staged provider-extensible ingress refactor.
- Remove the GitHub-only config contract from the design docs and replace it with the target shared app config plus provider-owned sections.
- Mark the new contract as pending until the runtime plans below land so the docs stay honest during the transition.

### Plan 12: Shared app contracts and config loading [done]

- Replace the GitHub-only core config with a provider-agnostic app config that validates only shared runtime keys.
- Preserve arbitrary top-level provider sections on the parsed config so providers can interpret and validate their own fields.
- Make workflow trigger keys generic non-empty strings while preserving YAML declaration order and first-match-wins selection.

### Plan 13: Provider app runtime and submission engine [done]

- Replace the GitHub-only webhook server with a route-registered provider app that dispatches requests by provider URL.
- Add request-scoped app context methods for collecting triggers and submitting them through the shared workflow engine.
- Keep one-workflow-per-request behavior and make provider-supplied `env` values flow into executor launches.

### Plan 14: GitHub provider migration and regression coverage [done]

- Move the current GitHub signature checks, whitelist rules, trigger normalization, and token generation into a GitHub provider module.
- Register the GitHub provider from `src/app/` using provider-owned config and route wiring.
- Update tests, fixtures, docs status, and regression coverage so the new provider model is the implemented runtime.

### Plan 15: GitHub App webhook redelivery polling [done]

- Add provider-owned `gh.redelivery` validation with `false | { intervalSeconds, maxPerRun }` semantics and keep the config parsing inside GitHub startup code rather than the shared loader.
- Poll recent GitHub App webhook deliveries from `main.ts`, retry unresolved failed delivery GUIDs once per GUID, and persist a small checkpoint beside the tracked run artifacts.
- Add focused coverage and docs for the redelivery worker, delivery API client, and new operator-facing config.

### Plan 16: Open-source guide and command surface cleanup [done]

- Rewrite `README.md` into an operator-first guide for running Coding Automator against GitHub issues.
- Remove the legacy startup env fallback so the CLI requires `--config`.
- Narrow GitHub issue command aliases to `plan` and `approve`, then update docs, fixtures, and regression coverage to match.

### Plan 17: Additional event-source providers

- Register at least one new non-GitHub event provider on top of the shared app context, routing, workflow submission, and tracking contract.
- Keep provider-specific auth, payload parsing, trigger mapping, and config validation inside provider-owned code instead of leaking it into the shared runtime.
- Extend startup wiring, docs, fixtures, and regression coverage so multiple event sources can coexist without changing first-match-wins workflow behavior.

## Definition Of Done For Each Plan

- Code follows the declared architecture layers.
- `npm run check` passes.
- Docs and checks that define the new invariant land in the same plan.
- The next numbered plan can start without needing to backfill missing foundations from the current one.
