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
    run: /path/to/codex --yolo -w ${workspace} exec ${prompt}
    workspace: true
    timeoutMs: 900000
    env:
      FOO: BAR
  claude:
    run: /path/to/claude --yolo ${prompt}
    workspace: false
    timeoutMs: 900000
    env:
      FOO: BAR
workflow:
  issue-plan:
    on:
      - issue:open
      - issue:command:plan
    use: codex
    prompt: Check issue ${in.issueId}. Make an implementation plan and comment on this issue. Do not write any code.
  issue-implement:
    on:
      - issue:command:approve
    use: claude
    prompt: Check issue ${in.issueId}. Assign the issue to yourself, implement your plan, and open a PR.
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
- `workspace`: workspace lifecycle policy for executor runs.
- `executors`: named command templates plus static environment variables.
- `executors.<name>.workspace`: optional workspace override. Use `true` to force allocation with `workspace.baseDir`, `false` to disable allocation, a string to override the parent workspace directory, or omit it to inherit `workspace.enabled`.
- `executors.<name>.timeoutMs`: optional per-executor timeout in milliseconds.
- `workflow`: ordered workflow definitions keyed by workflow name.
- Any other top-level key is provider-owned configuration. The core app preserves those sections and registered providers validate them at startup.
- The shipped startup wiring currently reads and registers `gh`. Other provider sections are preserved for future startup registration.
- `gh.requireMention` is optional and defaults to `true`. Set it to `false` to allow issue comments and slash commands on issues without a leading bot mention.
- `gh.ignoreApprovalReview` is optional and defaults to `true`. When enabled, approved `pull_request_review` events are ignored instead of emitting `pr:review`.
- `gh.redelivery` is optional. Use `false` or omit it to disable background webhook redelivery polling.

## Provider Runtime Model

- `src/app/` registers provider handlers against provider-owned route paths such as `gh.url`.
- A provider handler accepts `(req, res, context)` and owns request parsing, request validation, provider-specific auth, and the HTTP response.
- The shared `context` exposes:
  - `config`: the parsed app config plus provider-owned sections.
  - `trigger(name, { in, env })`: register one candidate trigger with provider-defined template input and optional per-run environment variables.
  - `submit()`: match all submitted triggers against workflows and launch at most one workflow.
- Providers may submit more than one trigger for one request, but the core runtime still selects only one workflow.

## Matching Rules

- Provider handlers may submit multiple candidate triggers for a single request.
- Workflows are evaluated in YAML declaration order.
- The first workflow whose `on` list contains any candidate trigger is selected.
- Only one workflow runs per request.
- Trigger keys are exact-match strings. The core runtime does not reserve prefixes or provider namespaces.
- Providers may prefix trigger names when teams want collision avoidance, but the core runtime does not require them.

## Interpolation Rules

- Workflow prompts may use `${in.*}` variables.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` is the rendered workflow prompt.
- `${workspace}` is the per-run workspace path when the selected executor resolves to workspace allocation, otherwise an empty string.
- Executor `env` entries are added to the child process environment for that run.
- Provider-supplied `trigger(..., { env })` values are added to the child process environment for the matched run.
- Environment merge order is `base process env -> executor env -> trigger env`.
- Executor `${prompt}` and `${workspace}` values are shell-escaped before the command runs through `/bin/sh -lc`.
- Missing or unsupported template variables throw an error.
- `null` template values render as an empty string.
- Objects and arrays render as compact JSON.

## `in` Variables

- `in` is a provider-defined plain object.
- The core runtime does not require shared fields inside `in`.
- Providers define the `in` object. The current GitHub provider keeps it minimal and emits only `event`, `user`, `repo`, and when relevant `issueId`, `prId`, `content`, `prReview`, and `command`.
- Missing fields still fail fast in templates when referenced.

## Workspace Rules

- `workspace.enabled` remains the service-level default for whether executors allocate a workspace.
- `executors.<name>.workspace` overrides that default per executor:
  - omit it to inherit `workspace.enabled`
  - set `false` to disable workspace allocation
  - set `true` to allocate under `workspace.baseDir`
  - set a string to allocate under that string path instead of `workspace.baseDir`
- When workspace allocation is enabled for a run, the service creates a fresh subdirectory under the selected parent directory.
- When workspace allocation is disabled for a run, the service does not create a workspace automatically.
- When `workspace.cleanupAfterRun` is `true`, the run directory is removed when reconciliation observes that the detached run completed.
- Command templates that reference `${workspace}` should be wrapped so they behave correctly when the value is empty.

## Tracking Rules

- Workflow runs are launched as detached background processes.
- `tracking.stateFile` stores non-terminal runs with saved PID, command, workspace path, and artifact file paths.
- `tracking.logFile` appends terminal workflow outcomes as JSON lines.
- The service reconciles saved runs on startup and during normal operation by checking the saved PID and reading the detached process result file.
- Tracking stays provider-agnostic. The matched trigger name and selected workflow are persisted with each run.
- Full executor stdout and stderr are saved in per-run artifact files. Runtime console logs show only clipped previews when the active log level enables them.

## Runtime Startup

- The service starts with `npm start -- --config /path/to/service.yml`.
- The shipped GitHub provider validates `gh.*` and requires `GITHUB_WEBHOOK_SECRET` plus `GITHUB_APP_PRIVATE_KEY_PATH` during startup.
- When `gh.redelivery` is enabled, `main.ts` starts a second GitHub App polling loop that scans the last 3 days of app webhook deliveries, retries unresolved failures once per delivery GUID, and persists its checkpoint beside the tracked run artifacts.
