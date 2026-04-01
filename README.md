# GitHub Agent Orchestrator

This repository defines an agent-friendly codebase for a GitHub App driven automation service. The planned product receives GitHub webhooks, filters them through a YAML configuration file, builds structured prompts from GitHub context, and dispatches configurable executor commands to plan or execute work.

## Current Status

This phase initializes the product documentation and TypeScript scaffolding. The product runtime is not implemented yet, but the repo now builds and runs a minimal TypeScript entrypoint.

## Quick Start

```bash
npm install
npm run check
npm start
npm run plan:new -- add-webhook-intake
```

`npm start` currently runs a TypeScript `Hello, world!` placeholder. It is not the future webhook service.

## Planned Workflow Model

1. A GitHub App webhook arrives with installation context.
2. The service loads a YAML config that defines whitelisted users, whitelisted repos, executors, workflows, and workspace behavior.
3. The webhook is normalized into one or more canonical triggers such as `issue:open`, `issue:command:plan`, `issue:comment`, `pr:comment`, or `pr:review`.
4. Workflows are evaluated in file order and the first matching workflow runs.
5. The selected workflow renders a prompt from the normalized GitHub inputs, then dispatches the configured executor command template.

## Config Model

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

- `clientId` identifies the GitHub App client ID this service should accept.
- `whitelist.user` and `whitelist.repo` gate which actors and repositories may trigger workflows.
- `executors` are named command templates plus per-executor environment variables.
- `workflow` is an ordered mapping. The first workflow whose `on` list matches the normalized event wins.

## Trigger Semantics

- `issue:open` fires when a whitelisted user opens a new issue in a whitelisted repo.
- `issue:command:<name>` is derived from an issue comment that mentions the bot with `@<bot-handle> /<name>` or `@<bot-handle> <name>`.
- `issue:comment` is the generic issue mention trigger for `@<bot-handle> <request>`.
- `pr:comment` and `pr:review` are PR-side review inputs from whitelisted users.
- A single webhook may yield multiple candidate triggers. The service must run only the first matching workflow in YAML order. This is why `issue-plan` must appear before `issue-at`.

## Variable Interpolation

- Workflow prompts may use `${in.issueId}`, `${in.prId}`, `${in.repo}`, and `${in.content}`.
- Executor commands may use `${prompt}` and `${workspace}`.
- When `workspace.enabled` is `true`, each execution creates a new subdirectory under `workspace.baseDir` and `${workspace}` resolves to that path.
- When `workspace.enabled` is `false`, the service does not create a workspace and `${workspace}` resolves to an empty string. Executor wrappers should tolerate that case.

## Repository Guide

- `AGENTS.md` is the agent entry point and repo table of contents.
- `ARCHITECTURE.md` defines the intended layer model for the future service.
- `docs/product-specs/starter-scope.md` captures the first implementation slice.
- `docs/design-docs/core-beliefs.md` records the design choices that should remain stable as code is added.
- `docs/design-docs/workflow-config.md` records the YAML config contract and matching rules.
- `scripts/` contains the harness checks and the execution-plan generator.
- `tsconfig.json` defines the TypeScript compiler settings for `src/` and `tests/`.
