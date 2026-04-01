# GitHub Agent Orchestrator

GitHub Agent Orchestrator is a YAML-driven GitHub App webhook automation service. It verifies webhook deliveries, filters them through repo and user whitelists, normalizes supported GitHub events into canonical triggers, renders prompts from normalized workflow input, and dispatches configured executor commands.

## Current Status

The starter runtime is implemented. The repository now includes config loading and validation, template rendering, execution services, webhook normalization, deterministic workflow selection, an HTTP webhook server, fixture-driven workflow tests, and CI for `npm run check`.

## Quick Start

1. Install dependencies.
2. Create `.env` with `GITHUB_WEBHOOK_SECRET=...`.
3. Create a YAML config file.
4. Run the service.

```bash
npm install
npm run check
npm start -- --config ./service.yml
```

You can also set `GITHUB_AGENT_ORCHESTRATOR_CONFIG=./service.yml` instead of passing `--config`.

## Config Model

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
    - octocat
  repo:
    - acme/demo
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
    prompt: Check PR ${in.prNumber} in repo ${in.repo}. You received review input: ${in.content}.
```

## Workflow Model

1. A GitHub App webhook arrives on `server.webhookPath`.
2. The server verifies `X-Hub-Signature-256`, parses JSON, checks installation presence, and enforces `whitelist.user` and `whitelist.repo`.
3. Supported events are normalized into canonical triggers such as `issue:open`, `issue:command:plan`, `issue:comment`, `pr:comment`, and `pr:review`.
4. Workflows are evaluated in YAML declaration order and stop at the first match.
5. The selected workflow renders a prompt from `${in.*}` fields and the executor command runs through `/bin/sh -lc`.

## Template Variables

- Workflow prompts may use `${in.*}` variables.
- Common aliases include `${in.repo}`, `${in.subjectNumber}`, `${in.prNumber}`, `${in.content}`, `${in.actorLogin}`, and `${in.eventName}`.
- Structured fields include `${in.repository.fullName}`, `${in.subject.kind}`, `${in.comment.body}`, and `${in.review.state}`.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` and `${workspace}` are shell-escaped before command execution.
- Missing or unsupported template variables fail fast.

## Production Bootstrap

- The service reads `GITHUB_WEBHOOK_SECRET` from `.env` or the ambient environment.
- Start with `npm start -- --config /path/to/service.yml`.
- Point your GitHub App webhook URL at `http(s)://<host>:<port><webhookPath>`.
- Executors are command templates only; containerization, sandboxing, and repo checkout strategy stay operator-defined.

## Repository Guide

- `AGENTS.md` is the agent entry point and repo table of contents.
- `ARCHITECTURE.md` defines the layer model.
- `docs/product-specs/starter-scope.md` captures the shipped starter scope.
- `docs/design-docs/workflow-config.md` defines the YAML contract and `in` variable model.
- `scripts/` contains the harness checks.
- `.github/workflows/check.yml` runs `npm run check` in CI.
