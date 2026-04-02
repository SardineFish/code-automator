# GitHub Agent Orchestrator

GitHub Agent Orchestrator is a YAML-driven GitHub App webhook automation service. It verifies webhook deliveries, filters them through repo and user whitelists, normalizes supported GitHub events into canonical triggers, renders prompts from normalized workflow input, launches executor commands as detached background runs, persists workflow status to files, and recovers tracking after restart.

## Current Status

The starter runtime is implemented with persistent workflow tracking and a GitHub-only ingress path.

Plans 11-14 in `docs/PLAN.md` reset the public contract toward a provider-extensible ingress model. The code in `src/` is still on the current GitHub-only runtime until those plans land.

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

## Planned Provider Config

This is the target config contract for the staged ingress refactor, not the currently implemented runtime.

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
    prompt: Check PR ${in.prNumber} in repo ${in.repo}. You received review input: ${in.content}.
```

Relative `tracking` paths are resolved relative to the YAML config file location.

## Planned Workflow Model

1. `src/app/` registers provider handlers against provider-owned routes such as `gh.url` and `gitlab.url`.
2. A provider receives the request, validates provider-specific policy, and calls `context.trigger(name, { in, env })` one or more times.
3. `context.submit()` evaluates workflows in YAML declaration order and stops at the first match.
4. The selected workflow renders a prompt from the matched trigger's `${in.*}` fields.
5. The service creates a queued workflow record, launches the executor as a detached background process, and persists the PID plus artifact paths.
6. A reconciliation loop updates the state file and append-only run log when detached runs complete. On restart, the service reloads the state file and recovers run status from saved PIDs and result files.

## Template Variables

- Workflow prompts may use `${in.*}` variables.
- `in` is provider-defined. The core runtime does not require shared fields inside it.
- GitHub-specific aliases such as `${in.repo}`, `${in.subjectNumber}`, `${in.prNumber}`, and `${in.content}` remain part of the migrated GitHub provider contract.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` and `${workspace}` are shell-escaped before command execution.
- Missing or unsupported template variables fail fast.

## Trigger Environment

- Providers may attach per-request environment variables to the matched trigger through `context.trigger(..., { env })`.
- The executor launch environment is merged as base process env, then executor static env, then trigger env.
- The migrated GitHub provider will continue to inject `GITHUB_TOKEN` for executor runs that need GitHub App access.

## Persistent Tracking

- `tracking.stateFile` stores the current non-terminal workflow runs.
- `tracking.logFile` is an append-only JSONL log of terminal workflow outcomes.
- Per-run wrapper, PID, result, stdout, and stderr files are stored next to the state file under a derived run-artifacts directory.
- The service does not need graceful draining to preserve workflow status. It can stop immediately and recover tracking on restart from the persisted state and detached process metadata.

## Production Bootstrap

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
