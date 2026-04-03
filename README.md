# Coding Automator

A self-hosted service that turns GitHub issues into pull requests with local coding agents.

It receives GitHub webhooks, matches them against ordered workflows in YAML, launches executor commands as detached background runs, and tracks those runs on disk so it can recover after restart.

This repository is run with Coding Automator itself, so the project is dogfooding the issue-to-PR workflow it documents.

The runtime is event-provider extensible. Today the shipped provider is the GitHub App provider under `gh`, and the shared workflow engine is designed so future event sources can plug into the same routing, execution, and tracking model.

## What You Need

- Node.js 20 or newer
- A GitHub App installed on the repositories you want to automate
- A public webhook URL that GitHub can reach
- One or more coding agent CLIs available on the host, such as `codex` or `claude`
- A writable directory for tracking files and, if enabled, per-run workspaces

## GitHub App Setup

1. Create a GitHub App and set its webhook URL to your service URL plus the configured `gh.url` path, for example `/gh-hook`.
2. Set a webhook secret and store the GitHub App private key as a PEM file on the host running Coding Automator.
3. Install the app on the repositories you want the service to handle.
4. Set `gh.botHandle` to the handle users will mention in issue comments.
5. Configure `gh.whitelist.user` and `gh.whitelist.repo` so only trusted actors and repositories can trigger runs.
6. Grant the app the permissions your agents need to read issues, post comments, push branches, and open pull requests.
7. For the issue-to-PR flow, enable at least the `Issues` and `Issue comments` webhook events.

## Quick Start

1. Install dependencies.
2. Create `.env` with:
   - `GITHUB_WEBHOOK_SECRET=...`
   - `GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/app.pem`
3. Create `service.yml`.
4. Start the service with an explicit config path.

```bash
npm install
npm run check
npm start -- --config ./service.yml
```

## Minimal Config

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
  whitelist:
    user:
      - octocat
    repo:
      - acme/demo
executors:
  codex:
    run: /path/to/codex exec ${prompt}
  claude:
    run: /path/to/claude ${prompt}
workflow:
  issue-plan:
    on:
      - issue:open
      - issue:command:plan
    use: codex
    prompt: Check issue ${in.issueId} in ${in.repo}. Write an implementation plan and post it as an issue comment. Do not write code.
  issue-implement:
    on:
      - issue:command:approve
    use: claude
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the approved plan, push your branch, and open a pull request.
  issue-at:
    on:
      - issue:at
    use: codex
    prompt: Check issue ${in.issueId} in ${in.repo}. Reply to the user's request: ${in.content}. Do not write code.
```

Relative `tracking` paths resolve from the YAML file location. The config loader preserves additional top-level provider sections, but the shipped startup wiring currently registers only `gh`.

## Event Providers

- The current production provider is the GitHub App provider configured under `gh`.
- Providers own their inbound route, request parsing, auth, trigger naming, and provider-specific config.
- The shared runtime owns workflow matching, executor launch, persistent tracking, and restart recovery.
- The YAML contract already preserves additional top-level provider sections so new event sources can be added without changing the core workflow model.
- The current roadmap includes support for more event sources on top of the same provider contract.

## Issue Flow

- Opening an issue or commenting `@<bot-handle> /plan` triggers the planning workflow.
- Commenting `@<bot-handle> /approve` triggers the implementation workflow.
- `issue:at` and `pr:at` fire whenever `@<bot-handle>` appears anywhere in an issue or PR comment body.
- When `gh.requireMention` is `false`, issue comments may match `issue:comment` without a mention, and `/plan` or `/approve` on issues no longer need a leading mention.
- `gh.ignoreApprovalReview` is optional and defaults to `true`. When enabled, approved `pull_request_review` events are acknowledged but do not trigger `pr:review`; set it to `false` to keep routing approve-review bodies.
- Workflow matching is first-match-wins, so put command-specific workflows before mention or generic comment workflows.

## Optional Redelivery Polling

`gh.redelivery` is provider-owned and defaults to `false`. When enabled, the service polls recent GitHub App webhook deliveries, retries unresolved failed delivery GUIDs once per GUID, and caps each scan at `maxPerRun` redelivery requests. On GitHub.com, only deliveries from the last 3 days are eligible for redelivery.

```yaml
gh:
  ...
  redelivery:
    intervalSeconds: 300
    maxPerRun: 20
```

The redelivery worker stores its checkpoint next to the tracked run artifacts under `tracking.stateFile`.

## Configuration Notes

- Workflow prompts may use `${in.*}` variables.
- Executor commands may use `${prompt}` and `${workspace}`.
- `${prompt}` and `${workspace}` are shell-escaped before command execution.
- The current GitHub provider keeps `in` intentionally small. It emits `event`, `user`, `repo`, and when relevant `issueId`, `content`, and `command`.
- The executor launch environment is merged as `base process env -> executor env -> trigger env`.
- The shipped GitHub provider injects `GH_TOKEN` for matched runs so your agent can call GitHub as the app installation.
- When `workspace.enabled` is `false`, `${workspace}` resolves to an empty string.

## Operations

- Runs are launched as detached background processes.
- `tracking.stateFile` stores non-terminal runs, and `tracking.logFile` stores append-only terminal outcomes.
- Per-run wrapper, PID, result, stdout, and stderr files are stored next to the state file under a derived run-artifacts directory.
- The service can stop immediately and recover workflow state on restart from persisted tracking metadata.
- If `gh.redelivery` is enabled, a second background worker scans recent GitHub App deliveries and requests redelivery for unresolved failures.
- `logging.level: debug` adds inbound request metadata and clipped executor command and stdout previews to runtime logs.
- Executors are command templates only; containerization, sandboxing, and repo checkout strategy stay operator-defined.

## Further Reading

- `AGENTS.md` is the repo table of contents for humans and agents.
- `ARCHITECTURE.md` defines the layer model.
- `docs/product-specs/starter-scope.md` captures the shipped starter scope.
- `docs/design-docs/workflow-config.md` documents the full YAML contract.
- `.github/workflows/check.yml` runs `npm run check` in CI.
