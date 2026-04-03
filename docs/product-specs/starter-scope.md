# Starter Scope

The current starter scope for Coding Automator is a provider-extensible ingress runtime with a shipped GitHub provider.

## Goals

- Load a single YAML config file containing shared app config plus arbitrary provider-owned top-level sections such as `gh`, `gitlab`, and `chat-bot`.
- Route incoming HTTP requests to registered providers by provider-owned URL paths.
- Let provider handlers parse requests, validate provider-specific policy, submit one or more candidate triggers, and write the HTTP response.
- Normalize provider input into provider-defined `in` objects plus optional per-run environment variables.
- Evaluate workflows in declaration order and run only the first matching workflow.
- Keep the initial GitHub workflow set `issue-plan`, `issue-implement`, `issue-at`, and `pr-review` working behind the GitHub provider.
- Render workflow prompts from provider-defined `${in.*}` fields.
- Launch the configured executor command with `${prompt}`, `${workspace}`, executor-specific environment variables, optional executor timeouts, and any provider-supplied request-scoped environment variables.
- Persist workflow run state to a JSON file and append terminal results to a JSONL log.
- Recover tracked workflow status on restart from saved PIDs and detached-process result files.
- Support service-side workspace settings with `workspace.enabled`, `workspace.baseDir`, and `workspace.cleanupAfterRun`.
- Keep GitHub-specific auth, signature verification, and whitelist behavior inside the GitHub provider rather than the core app.
- Optionally poll GitHub App webhook deliveries and request one redelivery per unresolved failed delivery GUID within GitHub's 3-day redelivery window.

## Non-Goals

- No built-in Docker runtime assumption. Executors may call scripts that use Docker, but the service contract stays command-template-based.
- No repo-stored workflow configuration.
- No multi-workflow fan-out for a single request. First match only.
- No auto-created workspace when `workspace.enabled` is `false`.
- No system-wide provider schema registry in the core config loader. Providers own validation for their top-level config sections.
- No required trigger prefix convention in code. Providers may share or prefix trigger names by documentation and team policy.
- No shipped GitLab or chat-bot provider implementation yet. Extra provider config sections are preserved, but startup currently registers only GitHub.

## Workflow Contract

The shipped GitHub workflows are:

- `issue-plan`
  - `on`: `issue:open`, `issue:command:plan`
  - `use`: `codex`
  - purpose: make an implementation plan and comment on the issue without writing code
- `issue-implement`
  - `on`: `issue:command:approve`
  - `use`: `claude`
  - purpose: implement the approved plan and open a PR
- `issue-at`
  - `on`: `issue:at`
  - `use`: `codex`
  - purpose: handle a generic bot mention in an issue without writing code
- `pr-review`
  - `on`: `pr:comment`, `pr:review`
  - `use`: `codex`
  - purpose: react to PR feedback from a whitelisted user

The GitHub planning workflow should render a prompt shaped like:

```text
Check issue ${in.issueId}. Make an implementation plan and comment on this issue. Do not write any code.
```

The GitHub generic issue mention workflow should render a prompt shaped like:

```text
Check issue ${in.issueId}. Handle the user's request: ${in.content}. Do not write any code.
```

By default, the GitHub provider normalizes `@<bot-handle> /plan` and `@<bot-handle> /approve` to issue command triggers. When `gh.requireMention` is `false`, `/plan` and `/approve` on issues also normalize without a leading mention.

The GitHub provider emits `issue:at` and `pr:at` whenever `@<bot-handle>` appears anywhere in an issue or PR comment body.

## Match Precedence

- A provider may submit more than one trigger for a single request.
- Workflow selection is declaration-order based, so command handlers such as `issue-plan` must appear before catch-all handlers such as `issue-at`.
- The service should stop after the first matching workflow and should not fan out one request into multiple executor runs.

## Workspace Defaults

- `workspace.enabled`: `false`
- `workspace.baseDir`: operator-defined
- `workspace.cleanupAfterRun`: `false`

When workspaces are enabled, each execution creates a fresh subdirectory under `workspace.baseDir`. When disabled, the executor runs without an auto-created workspace and `${workspace}` resolves to an empty string.
