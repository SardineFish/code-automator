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

### Plan 18: GitHub handler runtime error reports [done]

- Keep GitHub runtime-failure reporting provider-owned by posting directly to the current issue or pull request thread from the GitHub handler.
- Wrap the handler request-to-submit path with one `try/catch` so JavaScript runtime errors can report the message plus stack trace before returning `500`.
- Add regression coverage for issue-thread and PR-thread failure reporting while preserving the existing matched-run reaction behavior on success.

### Plan 19: Ignore approved GitHub PR reviews by default [done]

- Add provider-owned `gh.ignoreApprovalReview` config with a default value of `true`.
- Keep approved `pull_request_review` events provider-owned by ignoring them in the GitHub handler when the option is enabled, while preserving `changes_requested`, review comments, and PR issue comments.
- Update regression coverage, fixtures, and operator docs so approved reviews are no longer documented as actionable by default.

### Plan 20: Workflow terminal listeners and delayed GitHub failure reports [done]

- Add a small request-scoped terminal listener API on `AppContext` and bridge it into the workflow tracker after a run is queued without changing `submit()` semantics.
- Emit process-local terminal `completed` and `error` callbacks from the tracker while keeping persistence authoritative and isolating listener failures behind warning logs.
- Extend the GitHub provider to post queued terminal `failed`, `error`, and `lost` outcomes back to the issue or pull request thread with focused regression coverage.

### Plan 21: Keyed reusable workspaces and issue lifecycle cleanup [done]

- Extend executor workspace config to support an input-rendered `workspace.key`, reusable workspace directories, and executor command interpolation with `${workspaceKey}`.
- Persist keyed queue ownership plus pending launch context so runs that share one workspace key serialize cleanly across executors and survive restart.
- Add Codex reuse and reset wrappers, then route GitHub `issue:close` and `/reset` through the documented cleanup path with focused regression coverage.

### Plan 22: Executor runtime environment template support [done]

- Expose the merged executor runtime environment to command templates through `${env.*}` so templates can reference the same values the child process receives.
- Keep `${env.NODE_BIN}` available as a stable helper for the current Node.js binary path from `process.execPath`.
- Let the Codex reuse wrapper accept the Codex executable or wrapper path as an explicit argument so operators can choose launchers per executor.

### Plan 23: Absolute workspace paths and reset diagnostics [done]

- Resolve service-level and executor-level workspace base directories relative to the YAML config file so `${workspace}` is always absolute when allocation is enabled.
- Add focused config-loader coverage that locks in absolute workspace path behavior for relative config values.
- Add reset-session diagnostics that log the resolved workspace path, metadata cleanup, cwd handling, and final deletion step to the run stderr artifact.

### Plan 24: README workflow examples and safety guidance [done]

- Reorganize the README so it starts with one simple issue-to-PR service example before introducing more advanced workflow patterns.
- Add a clearer expanded workflow walkthrough that explains how GitHub issue and PR comments trigger the documented plan, approve, and review flows.
- Document keyed workspace setup, host-security risks, and a minimal Docker executor example for operators who want stronger isolation.

### Plan 25: Raise the Node.js runtime floor [done]

- Require Node.js 22 or newer in the package metadata so local installs and operators see the supported runtime clearly.
- Update CI to run the check workflow on Node.js 22 so the documented support floor and automation stay aligned.

### Plan 26: Config-relative helper scripts and split reusable-session state [done]

- Add `${configDir}` as an executor command template variable that resolves to the loaded YAML config directory.
- Keep reusable-session helper scripts unchanged while documenting config-relative helper-script invocation.
- Update the reusable-session docs and regression coverage so helper-script resolution no longer depends on the executor process `cwd`.

### Plan 27: Workflow prompt file includes [done]

- Add `${file:path}` support for `workflow.<name>.prompt` so operators can move large prompt bodies into text files.
- Resolve top-level include paths from the YAML config file and nested include paths from the including prompt file while preserving later `${in.*}` rendering.
- Add focused config-loader coverage plus operator docs for nested includes, missing files, and include cycles.

### Plan 28: Ignore PR review comments attached to a submitted review [done]

- Keep the duplication fix provider-owned by ignoring `pull_request_review_comment` deliveries that include `comment.pull_request_review_id`.
- Extend provider and redelivery regression coverage so standalone review comments still route while attached inline review comments no longer trigger separate workflows or mention handling.
- Update operator docs to clarify that inline review comments bundled into a submitted review are handled only through the submitted `pull_request_review` event.

### Plan 29: Rename request-scoped app context to workflow context [done]

- Rename the current request-scoped runtime contract from `AppContext` to `WorkflowContext` without changing submission behavior.
- Rename the request-scoped context factory from `createAppContext` to `createWorkflowContext` and keep call sites behaviorally identical.
- Update runtime, tracking, and provider listener type names from `AppContext*` to `WorkflowContext*` so request-scoped semantics stay explicit.

### Plan 30: App-level runtime context and shutdown wiring [done]

- Add the new app-level `AppContext` with dynamic `getProvider<T>()`, multi-workflow creation, and shutdown-handler registration while keeping `WorkflowContext` as the request-scoped submission unit.
- Refactor the shared app builder around generic providers and startup services, and route the built-in HTTP server through dynamic provider lookup by exact pathname.
- Make app shutdown own request draining plus workflow-tracking cleanup, with focused tests for app-context behavior, HTTP dispatch, and shutdown cleanup.

### Plan 31: Redelivery as a provider-owned app service [done]

- Move GitHub redelivery startup from manual `main.ts` wiring into a provider-owned app service that starts from `service(...)` and registers `stop()` through `app.on("shutdown", ...)`.
- Update shared startup wiring to register both the GitHub webhook provider and redelivery service through the app builder runtime path.
- Remove the explicit redelivery worker dependency from CLI shutdown so the app lifecycle owns that background service boundary.
- Add focused coverage for the redelivery service lifecycle while keeping the worker behavior and GitHub provider behavior otherwise unchanged.

### Plan 32: Runtime docs alignment [done]

- Update the operator and design docs to describe the request-scoped `WorkflowContext` plus the app-level `AppContext` split accurately.
- Describe GitHub redelivery as a provider-owned app service instead of manual CLI startup wiring.
- Keep the runtime operations docs aligned with app-owned shutdown of HTTP intake and background services.

### Plan 33: Built-in HTTP service lifecycle alignment [done]

- Register the built-in HTTP listener through the same `AppBuilder.service()` lifecycle path as the other app services.
- Keep app shutdown semantics intact by stopping request intake through app shutdown handlers and then waiting for idle requests before resolving `AppLifecycle.shutdown()`.
- Preserve exact-path dispatch and service-startup cleanup behavior while aligning the implementation with the documented runtime design.

### Plan 34: Direct GitHub redelivery service handler [done]

- Replace the public GitHub redelivery service creator with a direct app service handler export so startup wiring can register it without a wrapper.
- Keep the service logic provider-owned while preserving the same worker startup and shutdown behavior.
- Update focused service coverage to exercise the direct handler path with an injected worker stub.
### Plan 35: Shared outbound fetch retry and config consolidation [done]

- Move shared outbound provider fetch settings under optional top-level `fetch` config with `proxy` and `maxRetry`.
- Retry thrown outbound network failures in the shared `fetchHelper()` with a default retry budget of `3` while keeping HTTP response handling at the existing provider call sites.
- Update regression coverage and operator docs so the new fetch config shape and retry behavior stay documented and locked in.

### Plan 35: App-managed tracked jobs and built-in schedulers [done]

- Add app-managed tracked-job registration plus built-in interval and delay schedulers on `AppContext` so app-owned async work participates in graceful shutdown without growing a generic worker abstraction.
- Change app shutdown to cancel pending scheduler waits, log tracked jobs that are still being awaited, log a settle marker as each tracked job finishes during shutdown, and then wait for tracked jobs before the outer HTTP idle wait.
- Refactor GitHub redelivery to use the built-in app scheduler, keep detached workflow draining on the existing CLI `workflowTracker` path, and update focused coverage and docs for the new lifecycle boundary.

### Plan 36: Slash-prefixed HTTP provider keys [done]

- Add a shared `HttpProviderKey` type plus overloads on `provider()` and `getProvider()` so slash-prefixed literal keys resolve to `HttpRequestProvider` without splitting the unified provider registry.
- Thread validated HTTP route keys such as `gh.url` and built-in request pathname dispatch through that shared type while keeping runtime dispatch behavior unchanged.
- Add focused compile-time and runtime coverage plus operator docs for the slash-prefixed HTTP route convention and namespaced non-HTTP provider keys.

### Plan 37: Config-driven local extensions for providers and app services [done]

- Add a top-level ordered `extensions` config mapping that resolves local module paths from the service config directory while preserving arbitrary extension-owned `config` payloads.
- Load configured extensions after the explicit built-in GitHub registration in `src/app/main.ts`, and let them register providers and app services through the existing builder contract with exact `API_VERSION` checks.
- Add focused coverage, a standalone `extension/example.js`, and a type-only extension contract so operators can extend startup without changing core wiring.

### Plan 38: Extension runtime config access [done]

- Add `extensionConfig` to runtime workflow and app contexts, and thread the same generic through provider, service, and extension-builder contracts without changing app-level `config` semantics.
- Bind extension-owned config at the extension registration seam so registered providers and services receive extension-scoped runtime wrappers, and workflows created by extension services inherit the same config.
- Update focused runtime and type coverage plus the standalone extension contract, example, and operator docs so the new extension-config access path stays documented and locked in.

### Plan 39: Free GitHub issue slash commands [done]

- Replace the fixed GitHub issue slash-command list with leading command parsing that normalizes arbitrary issue commands into `issue:command:<name>`.
- Keep mention gating and first-match-wins workflow submission unchanged while extending regression coverage for custom commands, lowercase normalization, and non-command fallbacks.
- Update operator docs to document the allowed command characters `-`, `.`, `:`, and `_` plus the exact leading-command matching rules.

## Definition Of Done For Each Plan

- Code follows the declared architecture layers.
- `npm run check` passes.
- Docs and checks that define the new invariant land in the same plan.
- The next numbered plan can start without needing to backfill missing foundations from the current one.
