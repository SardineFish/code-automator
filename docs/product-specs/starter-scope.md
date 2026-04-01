# Starter Scope

The first implementation slice for GitHub Agent Orchestrator is a YAML-driven workflow engine that converts GitHub App webhooks into executor runs.

## Goals

- Load a single YAML config file containing `clientId`, `appId`, `botHandle`, `server`, `workspace`, `whitelist`, `executors`, and `workflow`.
- Receive GitHub App webhooks with installation context.
- Filter events by `whitelist.user` and `whitelist.repo`.
- Normalize webhook inputs into canonical triggers such as `issue:open`, `issue:command:plan`, `issue:command:approve`, `issue:comment`, `pr:comment`, and `pr:review`.
- Evaluate workflows in declaration order and run only the first matching workflow.
- Support the initial workflow set `issue-plan`, `issue-implement`, `issue-at`, and `pr-review`.
- Render workflow prompts from normalized input fields exposed through `${in.*}`, including simple aliases such as `${in.repo}`, `${in.subjectNumber}`, `${in.prNumber}`, and `${in.content}`.
- Launch the configured executor command with `${prompt}`, `${workspace}`, executor-specific environment variables, and optional executor timeouts.
- Support service-side workspace settings with `workspace.enabled`, `workspace.baseDir`, and `workspace.cleanupAfterRun`.
- Load the webhook secret from `.env` or the ambient environment through `GITHUB_WEBHOOK_SECRET`.

## Non-Goals

- No built-in Docker runtime assumption. Executors may call scripts that use Docker, but the service contract stays command-template-based.
- No repo-stored workflow configuration.
- No multi-workflow fan-out for a single webhook. First match only.
- No auto-created workspace when `workspace.enabled` is `false`.

## Workflow Contract

The initial documented workflows are:

- `issue-plan`
  - `on`: `issue:open`, `issue:command:plan`
  - `use`: `codex`
  - purpose: make an implementation plan and comment on the issue without writing code
- `issue-implement`
  - `on`: `issue:command:approve`, `issue:command:go`, `issue:command:implement`, `issue:command:code`
  - `use`: `claude`
  - purpose: implement the approved plan and open a PR
- `issue-at`
  - `on`: `issue:comment`
  - `use`: `codex`
  - purpose: handle a generic bot mention in an issue without writing code
- `pr-review`
  - `on`: `pr:comment`, `pr:review`
  - `use`: `codex`
  - purpose: react to PR feedback from a whitelisted user

The initial planning workflow should render a prompt shaped like:

```text
Check subject ${in.subjectNumber} in repo ${in.repo}. Make an implementation plan and comment on this issue. Do not write any code.
```

The generic issue mention workflow should render a prompt shaped like:

```text
Check subject ${in.subjectNumber} in repo ${in.repo}. Handle the user's request: ${in.content}. Do not write any code.
```

Command aliases normalize both `@<bot-handle> /plan` and `@<bot-handle> plan` to `issue:command:plan`. The same normalization rule applies to `approve`, `go`, `implement`, and `code`.

## Match Precedence

- A single comment may satisfy both a specific command trigger and the generic `issue:comment` trigger.
- Workflow selection is declaration-order based, so command handlers such as `issue-plan` must appear before catch-all handlers such as `issue-at`.
- The service should stop after the first matching workflow and should not fan out one webhook into multiple executor runs.

## Workspace Defaults

- `workspace.enabled`: `false`
- `workspace.baseDir`: operator-defined
- `workspace.cleanupAfterRun`: `false`

When workspaces are enabled, each execution creates a fresh subdirectory under `workspace.baseDir`. When disabled, the executor runs without an auto-created workspace and `${workspace}` resolves to an empty string.
