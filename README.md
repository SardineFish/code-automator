# GitHub Agent Orchestrator

GitHub Agent Orchestrator is a YAML-driven workflow automation service with a provider-extensible ingress runtime. It currently ships with a GitHub App provider that validates webhook deliveries, applies provider-specific whitelist rules, submits canonical workflow triggers, launches executor commands as detached background runs, persists workflow status to files, and recovers tracking after restart.

## Current Status

The runtime now uses a provider-extensible ingress app with persistent workflow tracking. `src/app/` registers the current GitHub provider at startup, and the shared app context handles trigger submission, workflow matching, detached execution, and restart reconciliation.

## Quick Start

1. Install dependencies.
2. Create `.env` with:
   - `GITHUB_WEBHOOK_SECRET=...`
   - `GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/app.pem`
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
  baseDir: /var/lib/github-agent-orchestrator/workspaces
  cleanupAfterRun: false
gh:
  url: /gh-hook
  clientId: your-github-app-client-id
  appId: 123456
  botHandle: github-agent-orchestrator
  whitelist:
    user:
      - octocat
    repo:
      - acme/demo
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
      - issue:open
      - issue:command:plan
    use: codex
    prompt: Check issue ${in.issueId}. Make an implementation plan and comment on this issue. Do not write any code.
  issue-implement:
    on:
      - issue:command:approve
      - issue:command:go
      - issue:command:implement
      - issue:command:code
    use: claude
    prompt: Check issue ${in.issueId}. Assign the issue to yourself, implement your plan, and open a PR.
  issue-at:
    on:
      - issue:comment
    use: codex
    prompt: Check issue ${in.issueId}. Handle the user's request: ${in.content}. Do not write any code.
  pr-review:
    on:
      - pr:comment
      - pr:review
    use: codex
    prompt: Check PR ${in.prId}. You received review input: ${in.content}.
```

Relative `tracking` paths are resolved relative to the YAML config file location.

The config loader preserves additional top-level provider sections, but the shipped startup wiring currently registers only the `gh` provider.

## Workflow Model

1. `src/app/` registers provider handlers against provider-owned routes. The current startup path registers the GitHub provider at `gh.url`.
2. A provider receives the request, validates provider-specific policy, and calls `context.trigger(name, { in, env })` one or more times.
3. `context.submit()` evaluates workflows in YAML declaration order and stops at the first match.
4. The selected workflow renders a prompt from the matched trigger's `${in.*}` fields.
5. The service creates a queued workflow record, launches the executor as a detached background process, and persists the PID plus artifact paths.
6. A reconciliation loop updates the state file and append-only run log when detached runs complete. On restart, the service reloads the state file and recovers run status from saved PIDs and result files.

## Template Variables

- Workflow prompts may use `${in.*}` variables.
- `in` is provider-defined. The core runtime does not require shared fields inside it.
- The current GitHub provider keeps `in` intentionally small. It emits `event`, `user`, and when relevant `issueId`, `prId`, `content`, `prReview`, and `command`.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` and `${workspace}` are shell-escaped before command execution.
- Missing or unsupported template variables fail fast.

## Trigger Environment

- Providers may attach per-request environment variables to the matched trigger through `context.trigger(..., { env })`.
- The executor launch environment is merged as base process env, then executor static env, then trigger env.
- The shipped GitHub provider injects `GITHUB_TOKEN` for executor runs that need GitHub App access.

## Persistent Tracking

- `tracking.stateFile` stores the current non-terminal workflow runs.
- `tracking.logFile` is an append-only JSONL log of terminal workflow outcomes.
- Per-run wrapper, PID, result, stdout, and stderr files are stored next to the state file under a derived run-artifacts directory.
- `logging.level` controls human-readable runtime logs. `info` logs trigger evaluation, workflow selection, and execution outcomes. `debug` additionally logs inbound HTTP request metadata plus clipped executor command/stdout previews.
- The service does not need graceful draining to preserve workflow status. It can stop immediately and recover tracking on restart from the persisted state and detached process metadata.

## Production Bootstrap

- Set `GITHUB_WEBHOOK_SECRET` and `GITHUB_APP_PRIVATE_KEY_PATH` for the shipped GitHub provider.
- Start with `npm start -- --config /path/to/service.yml`.
- Configure each provider's inbound URL path inside its provider section, for example `gh.url: /gh-hook`.
- Executors are command templates only; containerization, sandboxing, and repo checkout strategy stay operator-defined.

## Repository Guide

- `AGENTS.md` is the agent entry point and repo table of contents.
- `ARCHITECTURE.md` defines the layer model.
- `docs/product-specs/starter-scope.md` captures the shipped starter scope.
- `docs/design-docs/workflow-config.md` defines the YAML contract and `in` variable model.
- `scripts/` contains the harness checks.
- `.github/workflows/check.yml` runs `npm run check` in CI.
