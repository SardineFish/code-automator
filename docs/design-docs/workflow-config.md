# Workflow Config

This document captures the current YAML configuration contract for GitHub Agent Orchestrator.

## Example

```yaml
clientId: your-github-app-client-id
workspace:
  enabled: false
  baseDir: /var/lib/github-agent-orchestrator/workspaces
  cleanupAfterRun: false
whitelist:
  user:
    - Foo
  repo:
    - Bar/Baz
executors:
  codex:
    run: /path/to/codex --yolo -w ${workspace} exec ${prompt}
    env:
      FOO: BAR
  claude:
    run: /path/to/claude --yolo ${prompt}
    env:
      FOO: BAR
workflow:
  issue-plan:
    on:
      - issue:open
      - issue:command:plan
    use: codex
    prompt: Check issue ${in.issueId} in repo ${in.repo}. Make an implementation plan and comment on this issue. Do not write any code.
  issue-implement:
    on:
      - issue:command:approve
      - issue:command:go
      - issue:command:implement
      - issue:command:code
    use: claude
    prompt: Check issue ${in.issueId} in repo ${in.repo}. Assign the issue to yourself, implement your plan, and open a PR.
  issue-at:
    on:
      - issue:comment
    use: codex
    prompt: Check issue ${in.issueId} in repo ${in.repo}. Handle the user's request: ${in.content}. Do not write any code.
  pr-review:
    on:
      - pr:comment
      - pr:review
    use: codex
    prompt: Check PR ${in.prId} in repo ${in.repo}. You received a review comment: ${in.content}.
```

## Top-Level Keys

- `clientId`: the GitHub App client ID this service instance accepts.
- `workspace`: workspace lifecycle policy for executor runs.
- `whitelist`: the allowed GitHub users and repositories.
- `executors`: named command templates plus static environment variables.
- `workflow`: ordered workflow definitions keyed by workflow name.

## Trigger Normalization

- `issue:open` comes from a newly opened issue by a whitelisted user in a whitelisted repo.
- `issue:command:<name>` comes from an issue comment that mentions the bot with either `@<bot-handle> /<name>` or `@<bot-handle> <name>`.
- `issue:comment` is the generic issue mention trigger for `@<bot-handle> <request>`.
- `pr:comment` comes from a PR comment by a whitelisted user.
- `pr:review` comes from a PR review event by a whitelisted user.

## Matching Rules

- One webhook may produce multiple candidate triggers.
- Workflows are evaluated in YAML declaration order.
- The first workflow whose `on` list contains any candidate trigger is selected.
- Only one workflow runs per webhook.
- Generic handlers such as `issue:comment` must appear after specific command handlers such as `issue:command:plan`.

## Interpolation Rules

- Workflow prompts may use `${in.issueId}`, `${in.prId}`, `${in.repo}`, and `${in.content}`.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` is the rendered workflow prompt.
- `${workspace}` is the per-run workspace path when workspace creation is enabled, otherwise an empty string.
- Executor `env` entries are added to the child process environment for that run.

## Workspace Rules

- When `workspace.enabled` is `true`, the service creates a fresh subdirectory under `workspace.baseDir` for each execution.
- When `workspace.enabled` is `false`, the service does not create a workspace automatically.
- When `workspace.cleanupAfterRun` is `true`, the run directory is removed after execution completes.
- Command templates that reference `${workspace}` should be wrapped so they behave correctly when the value is empty.
