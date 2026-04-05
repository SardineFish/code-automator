# Workflow Config

This document captures the current YAML configuration contract for the provider-extensible ingress runtime.

## Example

```yaml
server:
  host: 0.0.0.0
  port: 3000
logging:
  level: info
tracking:
  stateFile: workflow-state.json
  logFile: workflow-runs.jsonl
fetch:
  proxy: socks5://proxy.internal:1080
  maxRetry: 3
extensions:
  example:
    use: ./extension/example.js
    config:
      my_url: /example-hook
      message: hello from extension
workspace:
  enabled: false
  baseDir: /var/lib/coding-automator/workspaces
  cleanupAfterRun: false
gh:
  url: /gh-hook
  clientId: your-github-app-client-id
  appId: 123456
  botHandle: coding-automator
  requireMention: true
  ignoreApprovalReview: true
  redelivery:
    intervalSeconds: 300
    maxPerRun: 20
  whitelist:
    user:
      - Foo
    repo:
      - Bar/Baz
gitlab:
  url: /gitlab-hook
chat-bot:
  url: /chat
executors:
  codex:
    run: ${env.NODE_BIN} ${configDir}/scripts/codex-reuse.js /absolute/path/to/codex ${prompt}
    workspace:
      baseDir: /var/lib/coding-automator/issues
      key: ${in.repo}#${in.issueId}
    timeoutMs: 900000
    env:
      FOO: BAR
  codex-reset:
    run: ${env.NODE_BIN} ${configDir}/scripts/reset-session.js ${workspace}
    workspace:
      baseDir: /var/lib/coding-automator/issues
      key: ${in.repo}#${in.issueId}
    timeoutMs: 900000
    env:
      FOO: BAR
workflow:
  issue-plan:
    on:
      - issue:open
      - issue:command:plan
    use: codex
    prompt: ${file:prompt/issue-plan.txt}
  issue-implement:
    on:
      - issue:command:approve
    use: codex
    prompt: Check issue ${in.issueId}. Assign the issue to yourself, implement your plan, and open a PR.
  issue-reset:
    on:
      - issue:command:reset
      - issue:close
    use: codex-reset
    prompt: Reset the reusable issue workspace for ${in.repo}#${in.issueId}.
  issue-at:
    on:
      - issue:at
    use: codex
    prompt: Check issue ${in.issueId}. Handle the user's request: ${in.content}. Do not write any code.
  pr-review:
    on:
      - pr:comment
      - pr:review
    use: codex
    prompt: Check PR ${in.prId}. You received actionable PR feedback: ${in.content}.
```

## Top-Level Keys

- `server`: listener host and port. Provider routes are declared inside provider sections such as `gh.url`.
- `logging`: runtime log level. Allowed values are `debug`, `info`, `warn`, and `error`. The default is `info`.
- `tracking`: persistent workflow state and append-only results log paths. Relative paths resolve from the YAML config file directory.
- `fetch`: optional shared outbound fetch settings for provider HTTP traffic.
- `fetch.proxy`: optional outbound proxy URI. Supported schemes are `http`, `https`, and `socks5`.
- `fetch.maxRetry`: optional retry budget for thrown network failures. The default is `3`.
- `extensions`: optional ordered mapping of local extension modules. Each entry accepts required `use` plus extension-owned `config`.
- `workspace`: workspace lifecycle policy for executor runs.
- `executors`: named command templates plus static environment variables.
- `executors.<name>.workspace`: optional workspace override. Use `true` to force allocation with `workspace.baseDir`, `false` to disable allocation, a string to override the parent workspace directory, a mapping with `baseDir` and/or `key`, or omit it to inherit `workspace.enabled`.
- `executors.<name>.timeoutMs`: optional per-executor timeout in milliseconds.
- `workflow`: ordered workflow definitions keyed by workflow name.
- Any other top-level key is provider-owned configuration. The core app preserves those sections and registered providers validate them at startup.
- The shipped startup wiring keeps GitHub explicit in `src/app/main.ts`, then loads configured local extensions in order.
- `gh.requireMention` is optional and defaults to `true`. Set it to `false` to allow issue comments and slash commands on issues without a leading bot mention.
- `gh.ignoreApprovalReview` is optional and defaults to `true`. When enabled, approved `pull_request_review` events are ignored instead of emitting `pr:review`.
- Inline `pull_request_review_comment` deliveries with `comment.pull_request_review_id` are ignored by the GitHub provider, so only standalone PR review comments emit `pr:comment` or `pr:at`.
- `gh.redelivery` is optional. Use `false` or omit it to disable background webhook redelivery polling.

## Provider Runtime Model

- `src/app/` registers provider handlers against provider-owned route paths such as `gh.url`.
- `src/app/` initializes the shared outbound `fetchHelper()` once from top-level `fetch`, and provider-owned outbound API calls use that helper instead of raw `fetch`.
- A provider handler accepts `(req, res, context)` and owns request parsing, request validation, provider-specific auth, and the HTTP response.
- The shared `context` exposes:
  - `config`: the parsed app config plus provider-owned sections.
  - `trigger(name, { in, env })`: register one candidate trigger with provider-defined template input and optional per-run environment variables.
  - `submit()`: match all submitted triggers against workflows and launch at most one workflow.
- Providers may submit more than one trigger for one request, but the core runtime still selects only one workflow.

## Extension Runtime Model

- `extensions.<id>.use` accepts only local filesystem paths and resolves relative to the YAML config file directory when it is not already absolute.
- A `use` target may point to one `.js`, `.mjs`, or `.cjs` file, or to one local package directory that resolves through its package entrypoint.
- Extension modules load through `module.default ?? module`.
- Each extension must export one object with an `API_VERSION` that matches the runtime-supported extension API version, plus `init(builder, context)`.
- `builder` exposes the same `provider()` and `service()` registration seam used by built-ins.
- `context` exposes `id`, extension-owned `config`, `configDir`, `env`, and an extension-scoped `log`.
- Extension startup is local-only and high-trust. The runtime does not sandbox extension code or download remote modules.

## Matching Rules

- Provider handlers may submit multiple candidate triggers for a single request.
- Workflows are evaluated in YAML declaration order.
- The first workflow whose `on` list contains any candidate trigger is selected.
- Only one workflow runs per request.
- Trigger keys are exact-match strings. The core runtime does not reserve prefixes or provider namespaces.
- Providers may prefix trigger names when teams want collision avoidance, but the core runtime does not require them.

## Interpolation Rules

- Workflow prompts may use `${in.*}` variables.
- `workflow.<name>.prompt` may also use `${file:path}` to inline another prompt file.
- Top-level prompt include paths resolve relative to the YAML config file directory.
- Nested prompt include paths resolve relative to the including file.
- Prompt files are expanded at config load, and the expanded prompt still renders `${in.*}` variables later at workflow execution.
- Executor commands may use `${configDir}`, `${prompt}`, `${workspace}`, `${workspaceKey}`, and `${env.<NAME>}`.
- `${configDir}` resolves to the directory containing the loaded service YAML config.
- `${prompt}` is the rendered workflow prompt.
- `${workspace}` is the per-run workspace path when the selected executor resolves to workspace allocation, otherwise an empty string.
- `${workspaceKey}` is the rendered `executors.<name>.workspace.key` value when configured, otherwise an empty string.
- `${env.<NAME>}` resolves from the final executor environment after merge order `base process env -> executor env -> trigger env`, plus injected values such as `GH_TOKEN` when present.
- `${env.NODE_BIN}` is the current Node.js binary path from `process.execPath`, even if it is not otherwise present in the child process environment.
- Executor `env` entries are added to the child process environment for that run.
- Provider-supplied `trigger(..., { env })` values are added to the child process environment for the matched run.
- Environment merge order is `base process env -> executor env -> trigger env`.
- Executor `${configDir}`, `${prompt}`, `${workspace}`, `${workspaceKey}`, and `${env.*}` values are shell-escaped before the command runs through `/bin/sh -lc`.
- Reusable-session helper scripts such as `codex-reuse.js` may accept additional positional arguments before `${prompt}`, for example a Codex wrapper path.
- Missing or unsupported template variables throw an error.
- `null` template values render as an empty string.
- Objects and arrays render as compact JSON.

## `in` Variables

- `in` is a provider-defined plain object.
- The core runtime does not require shared fields inside `in`.
- Providers define the `in` object. The current GitHub provider keeps it minimal and emits only `event`, `user`, `repo`, and when relevant `issueId`, `prId`, `content`, `prReview`, and `command`.
- For PR-scoped GitHub workflows, `issueId` is populated from GitHub's `closingIssuesReferences` result when GitHub resolves a linked issue for that PR.
- Missing fields still fail fast in templates when referenced.

## Workspace Rules

- `workspace.enabled` remains the service-level default for whether executors allocate a workspace.
- `workspace.baseDir`, string `executors.<name>.workspace`, and `executors.<name>.workspace.baseDir` resolve relative to the YAML config file directory when they are not already absolute.
- `executors.<name>.workspace` overrides that default per executor:
  - omit it to inherit `workspace.enabled`
  - set `false` to disable workspace allocation
  - set `true` to allocate under `workspace.baseDir`
  - set a string to allocate under that string path instead of `workspace.baseDir`
  - set a mapping with `baseDir` and/or `key` to allocate a reusable keyed workspace
- When workspace allocation is enabled for a run without a `workspace.key`, the service creates a fresh subdirectory under the selected parent directory.
- When `workspace.key` is configured, the rendered key is escaped into one stable directory name and reused across runs.
- When workspace allocation is disabled for a run, the service does not create a workspace automatically.
- When `workspace.cleanupAfterRun` is `true`, only ephemeral per-run directories are removed when reconciliation observes that the detached run completed.
- Reusable keyed workspaces are removed by explicit reset workflows such as `issue:command:reset` or `issue:close`.
- Runs that share one rendered workspace key are serialized, and the next queued keyed run is released when the current owner reaches a terminal state.
- Command templates that reference `${workspace}` should be wrapped so they behave correctly when the value is empty.

## Tracking Rules

- Workflow runs are launched as detached background processes.
- `tracking.stateFile` stores non-terminal runs with saved PID, command, workspace path, keyed queue state, and any queued launch context needed after restart.
- `tracking.logFile` appends terminal workflow outcomes as JSON lines.
- The service reconciles saved runs on startup and during normal operation by checking the saved PID and reading the detached process result file.
- Tracking stays provider-agnostic. The matched trigger name and selected workflow are persisted with each run.
- Full executor stdout and stderr are saved in per-run artifact files. Runtime console logs show only clipped previews when the active log level enables them.

## Runtime Startup

- The service starts with `npm start -- --config /path/to/service.yml`.
- The shipped GitHub provider validates `gh.*` and requires `GITHUB_WEBHOOK_SECRET` plus `GITHUB_APP_PRIVATE_KEY_PATH` during startup.
- `src/app/main.ts` keeps the built-in GitHub provider and redelivery service registration explicit, then loads configured local extensions before `listen()`.
- When `gh.redelivery` is enabled, the GitHub provider registers a background app service that uses the built-in app scheduler, waits one configured interval before its first scan, then scans the last 3 days of app webhook deliveries, retries unresolved failures once per delivery GUID, and persists its checkpoint beside the tracked run artifacts.
- App shutdown cancels pending app-managed scheduled waits, logs any tracked app jobs it is waiting on, logs a settle marker for each tracked job as it completes during shutdown, and still leaves detached workflow draining to the separate CLI `workflowTracker` boundary.
