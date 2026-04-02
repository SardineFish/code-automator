# Workflow Config

This document captures the target YAML configuration contract for the provider-extensible ingress refactor.

The runtime in `src/` is still GitHub-only until Plans 12-14 in `docs/PLAN.md` land. This doc is the staged target contract for that refactor.

## Example

```yaml
server:
  host: 0.0.0.0
  port: 3000
tracking:
  stateFile: workflow-state.json
  logFile: workflow-runs.jsonl
workspace:
  enabled: false
  baseDir: /var/lib/github-agent-orchestrator/workspaces
  cleanupAfterRun: false
gh:
  url: /gh-hook
  clientId: your-github-app-client-id
  appId: 123456
  botHandle: github-agent-orchestrator
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
    timeoutMs: 900000
    env:
      FOO: BAR
  claude:
    run: /path/to/claude --yolo ${prompt}
    timeoutMs: 900000
    env:
      FOO: BAR
workflow:
  issue-plan:
    on:
      - gh:issue:open
      - gh:issue:command:plan
    use: codex
    prompt: Check subject ${in.subjectNumber} in repo ${in.repo}. Make an implementation plan and comment on this issue. Do not write any code.
  issue-implement:
    on:
      - gh:issue:command:approve
      - gh:issue:command:go
      - gh:issue:command:implement
      - gh:issue:command:code
    use: claude
    prompt: Check subject ${in.subjectNumber} in repo ${in.repo}. Assign the issue to yourself, implement your plan, and open a PR.
  issue-at:
    on:
      - gh:issue:comment
    use: codex
    prompt: Check subject ${in.subjectNumber} in repo ${in.repo}. Handle the user's request: ${in.content}. Do not write any code.
  pr-review:
    on:
      - gh:pr:comment
      - gh:pr:review
    use: codex
    prompt: Check PR ${in.prNumber} in repo ${in.repo}. You received a review comment: ${in.content}.
```

## Top-Level Keys

- `server`: listener host and port. Provider routes are declared inside provider sections such as `gh.url`.
- `tracking`: persistent workflow state and append-only results log paths. Relative paths resolve from the YAML config file directory.
- `workspace`: workspace lifecycle policy for executor runs.
- `executors`: named command templates plus static environment variables.
- `executors.<name>.timeoutMs`: optional per-executor timeout in milliseconds.
- `workflow`: ordered workflow definitions keyed by workflow name.
- Any other top-level key is provider-owned configuration. The core app preserves those sections and registered providers validate them at startup.

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
- Provider docs should recommend prefixes such as `gh:` or `gitlab:` when teams want collision avoidance, but the core runtime does not require them.

## Interpolation Rules

- Workflow prompts may use `${in.*}` variables.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` is the rendered workflow prompt.
- `${workspace}` is the per-run workspace path when workspace creation is enabled, otherwise an empty string.
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
- Providers may choose to emit stable aliases such as `repo`, `subjectNumber`, or `content`, but that is a provider contract rather than a system-wide rule.
- Missing fields still fail fast in templates when referenced.

## Workspace Rules

- When `workspace.enabled` is `true`, the service creates a fresh subdirectory under `workspace.baseDir` for each execution.
- When `workspace.enabled` is `false`, the service does not create a workspace automatically.
- When `workspace.cleanupAfterRun` is `true`, the run directory is removed when reconciliation observes that the detached run completed.
- Command templates that reference `${workspace}` should be wrapped so they behave correctly when the value is empty.

## Tracking Rules

- Workflow runs are launched as detached background processes.
- `tracking.stateFile` stores non-terminal runs with saved PID, command, workspace path, and artifact file paths.
- `tracking.logFile` appends terminal workflow outcomes as JSON lines.
- The service reconciles saved runs on startup and during normal operation by checking the saved PID and reading the detached process result file.
- Tracking stays provider-agnostic. The matched trigger name and selected workflow are persisted with each run.

## Runtime Startup

- The service starts with `npm start -- --config /path/to/service.yml` or `GITHUB_AGENT_ORCHESTRATOR_CONFIG=/path/to/service.yml npm start`.
- Providers validate any required environment variables or secret file paths during startup when they are registered.
