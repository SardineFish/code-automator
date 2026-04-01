# Workflow Config

This document captures the current YAML configuration contract for GitHub Agent Orchestrator.

## Example

```yaml
clientId: your-github-app-client-id
appId: 123456
botHandle: github-agent-orchestrator
server:
  host: 0.0.0.0
  port: 3000
  webhookPath: /webhooks/github
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
      - issue:open
      - issue:command:plan
    use: codex
    prompt: Check subject ${in.subjectNumber} in repo ${in.repo}. Make an implementation plan and comment on this issue. Do not write any code.
  issue-implement:
    on:
      - issue:command:approve
      - issue:command:go
      - issue:command:implement
      - issue:command:code
    use: claude
    prompt: Check subject ${in.subjectNumber} in repo ${in.repo}. Assign the issue to yourself, implement your plan, and open a PR.
  issue-at:
    on:
      - issue:comment
    use: codex
    prompt: Check subject ${in.subjectNumber} in repo ${in.repo}. Handle the user's request: ${in.content}. Do not write any code.
  pr-review:
    on:
      - pr:comment
      - pr:review
    use: codex
    prompt: Check PR ${in.prNumber} in repo ${in.repo}. You received a review comment: ${in.content}.
```

## Top-Level Keys

- `clientId`: GitHub App client ID metadata.
- `appId`: GitHub App numeric ID metadata.
- `botHandle`: mention target used for trigger normalization.
- `server`: listener host, port, and webhook path.
- `workspace`: workspace lifecycle policy for executor runs.
- `whitelist`: the allowed GitHub users and repositories.
- `executors`: named command templates plus static environment variables.
- `executors.<name>.timeoutMs`: optional per-executor timeout in milliseconds.
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

- Workflow prompts may use `${in.*}` variables.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` is the rendered workflow prompt.
- `${workspace}` is the per-run workspace path when workspace creation is enabled, otherwise an empty string.
- Executor `env` entries are added to the child process environment for that run.
- Executor `${prompt}` and `${workspace}` values are shell-escaped before the command runs through `/bin/sh -lc`.
- Missing or unsupported template variables throw an error.
- `null` template values render as an empty string.
- Objects and arrays render as compact JSON.

## `in` Variables

`in` provides both structured event context and simple aliases.

### Structured Fields

- `in.event`: `name`, `action`, `deliveryId`, `candidateTriggers`, `matchedTrigger`.
- `in.repository`: `owner`, `name`, `fullName`, `defaultBranch`, `private`, `url`.
- `in.actor`: `login`, `id`, `type`, `url`.
- `in.installation`: `id`.
- `in.subject`: `kind`, `number`, `title`, `body`, `state`, `url`, `authorLogin`.
- `in.message`: `text`.
- Optional structured fields: `in.organization`, `in.enterprise`, `in.issue`, `in.pullRequest`, `in.comment`, `in.review`, `in.command`.

### Simple Aliases

- `in.repo`: repository full name (`Owner/Repo`).
- `in.repoOwner`, `in.repoName`.
- `in.actorLogin`.
- `in.content`: normalized text content.
- `in.subjectKind`, `in.subjectNumber`, `in.subjectTitle`, `in.subjectBody`, `in.subjectUrl`.
- `in.issueNumber`, `in.prNumber`.
- `in.commentBody`, `in.reviewState`, `in.commandName`.
- `in.eventName`, `in.eventAction`.

Aliases are convenience fields derived from structured context, and missing fields fail fast in templates when referenced.

## Workspace Rules

- When `workspace.enabled` is `true`, the service creates a fresh subdirectory under `workspace.baseDir` for each execution.
- When `workspace.enabled` is `false`, the service does not create a workspace automatically.
- When `workspace.cleanupAfterRun` is `true`, the run directory is removed after execution completes.
- Command templates that reference `${workspace}` should be wrapped so they behave correctly when the value is empty.

## Runtime Startup

- `GITHUB_WEBHOOK_SECRET` is loaded from `.env` or the ambient environment.
- The service starts with `npm start -- --config /path/to/service.yml` or `GITHUB_AGENT_ORCHESTRATOR_CONFIG=/path/to/service.yml npm start`.
