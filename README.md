# Coding Automator

A self-hosted service that turns GitHub issues into pull requests with local coding agents.

It receives GitHub webhooks, matches them against ordered workflows in YAML, launches executor commands as detached background runs, and tracks those runs on disk so it can recover after restart.

This repository is run with Coding Automator itself, so the project is dogfooding the issue-to-PR workflow it documents.

The runtime is event-provider extensible. Today the shipped provider is the GitHub App provider under `gh`, and the shared workflow engine is designed so future event sources can plug into the same routing, execution, and tracking model. Omitting `gh` disables the built-in GitHub provider and redelivery service so extension-only deployments can boot without GitHub-specific environment variables.

## What You Need

- Node.js 22 or newer
- A GitHub App installed on the repositories you want to automate if you enable the built-in `gh` provider
- A public webhook URL that GitHub can reach
- One or more coding agent CLIs available on the host, such as `codex` or `claude`
- For agents that support installable skills or plugins, a GitHub manipulation skill is strongly recommended so the agent can inspect issues, push branches, and open pull requests more reliably
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
2. If `service.yml` enables the built-in `gh` provider, create `.env` with:
   - `GITHUB_WEBHOOK_SECRET=...`
   - `GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/app.pem`
   If `gh` is omitted and you use only local extensions, those GitHub-specific environment variables are not required.
3. Create `service.yml`.
4. Start the service with an explicit config path.

```bash
npm install
npm run check
npm start -- --config ./service.yml
```

## Simple Issue To PR

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
  enabled: true
  baseDir: /path/to/save/workspaces
  cleanupAfterRun: false
gh:
  url: /gh-hook
  clientId: <your-github-app-client-id>
  appId: <your-github-app-id>
  botHandle: <BotName>
  whitelist:
    user:
      - octocat
    repo:
      - acme/demo
executors:
  codex:
    run: codex exec ${prompt}
workflow:
  issue-pr:
    on:
      - issue:open
    use: codex
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the issue, push a branch, and open a pull request.
```

This is the simplest end-to-end setup:

- opening an issue immediately launches one Codex run
- each run gets a fresh non-keyed workspace under `workspace.baseDir`
- no reusable session state is kept between runs

Relative `tracking` paths and workspace base directories resolve from the YAML file location. The config loader preserves provider-owned top-level sections such as `gh`, and the shipped startup wiring keeps GitHub explicit while also loading any configured local extensions. When `gh` is omitted, the built-in GitHub route and redelivery service are not registered.

## Provider Keys

Slash-prefixed provider keys are reserved for the built-in HTTP listener. The built-in HTTP service uses the exact request pathname as the provider lookup key, so route handlers should register on keys such as `/`, `/gh-hook`, or `/custom/api`.

Custom non-HTTP providers still use the same unified provider registry, but they should prefer namespaced keys such as `github:redelivery` or `foo:bar` when practical so they are visually distinct from HTTP routes.

## Outbound Fetch

Shared outbound provider API traffic retries thrown network failures up to 3 times by default.
To override the retry budget or route traffic through a proxy, add an optional top-level `fetch` section such as:

```yaml
fetch:
  proxy: http://proxy.internal:8080
  maxRetry: 5
# or
fetch:
  proxy: socks5://proxy.internal:1080
```

The shared helper is initialized once at app startup, all production outbound provider calls use it, and inbound webhook handling keeps using direct local server traffic.

## Extensions

Use extensions when you want to add another workflow provider, support other Git hosting workflows, or expose custom local APIs and startup services without modifying the core runtime.

```yaml
extensions:
  example:
    use: ./extension/example.js
    config:
      my_url: /example-hook
      message: hello from a local extension
```

Extension loading rules:

- `extensions` preserves YAML declaration order.
- `use` resolves relative to `service.yml` and must point to a local `.js`, `.mjs`, or `.cjs` file, or to a local package directory with a package entrypoint.
- The loader uses `module.default ?? module`.
- Each module must export an `API_VERSION` that matches the runtime-supported extension API version, plus `init(builder, context)`.
- Duplicate provider keys still fail fast across built-ins and extensions.

This repository ships a standalone example at `extension/example.js`. It registers one app service plus one HTTP provider route based on `context.config.my_url`.

For editor help in JavaScript or TypeScript extensions, use the standalone declaration file at `extension/extensions.d.ts`. The example extension already shows the intended JSDoc import pattern, and the declaration file is self-contained so extension authors can vendor it into their own project for development without taking a runtime dependency on Coding Automator.

During `init()`, `context.config` is still the extension-owned config blob. At runtime, provider handlers receive that same blob on `workflow.extensionConfig`, and extension services receive it on `app.extensionConfig`, while `config` on those runtime contexts remains the app-level service config.

## Expanded Workflow Example

Once the basic issue-to-PR flow works, you can split planning, implementation, and PR follow-up into separate workflows.

```yaml
executors:
  codex:
    run: codex exec ${prompt}
workflow:
  issue-plan:
    on:
      - issue:open
      - issue:command:plan
    use: codex
    prompt: ${file:prompt/issue-plan.txt}
  issue-implement:
    on:
      - issue:command:approve
    use: codex
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the approved plan, push a branch, and open a pull request.
  pr-review:
    on:
      - pr:comment
      - pr:review
    use: codex
    prompt: Check PR ${in.prId} in ${in.repo}. You received actionable PR feedback: ${in.content}. Review the feedback and update the pull request if needed.
```

`prompt/issue-plan.txt`

```text
Check issue ${in.issueId} in ${in.repo}. Write an implementation plan and post it as an issue comment. Do not write code.
```

Workflow prompt include paths resolve relative to `service.yml`. Nested `${file:...}` markers inside prompt files resolve relative to the including file, and the expanded prompt still renders with the normal `${in.*}` variables at runtime.

After this is configured, a typical GitHub flow looks like this:

1. Open an issue.
   Trigger event `issue:open` matches workflow `issue-plan`, so the agent writes an implementation plan as an issue comment.
2. Ask for a fresh plan again if needed.
   Comment `@<BotName> /plan` on the issue. `<BotName>` should match `gh.botHandle` in your config.
3. Approve the plan.
   Comment `@<BotName> /approve` on the issue. That triggers `issue-implement` workflow, and the agent should implement the plan, push a branch, and open a pull request.
4. Continue the PR loop.
   Later PR comments and PR reviews trigger `pr-review`, so the agent can react to review feedback and update the pull request.

If GitHub resolves a linked issue for that pull request, PR workflows also receive `in.issueId`. That lets keyed workspace setups such as `${in.repo}#${in.issueId}` reuse the original issue workspace and agent session across PR follow-up runs.

Webhook handling is still single-match. One incoming webhook request launches at most one workflow.

The GitHub provider may submit more than one candidate event for the same request. For example, one issue comment can produce both a command event and a generic mention event. The workflow engine then walks the YAML list in order and runs only the first workflow whose `on` list matches any submitted event.

Workflow order matters. Put the most specific command workflows first, then broader handlers later, because later matches are ignored once an earlier workflow wins.

## Keyed Workspace Example

Use a keyed workspace when one issue should keep the same checkout and Codex thread across multiple runs.

```yaml
workspace:
  enabled: false
  baseDir: /var/lib/coding-automator/workspaces
  cleanupAfterRun: false
executors:
  codex:
    run: ${env.NODE_BIN} ${configDir}/scripts/codex-reuse.js /path/to/codex ${prompt}
    workspace:
      baseDir: /var/lib/coding-automator/issues
      key: ${in.repo}#${in.issueId}
  codex-reset:
    run: ${env.NODE_BIN} ${configDir}/scripts/reset-session.js ${workspace}
    workspace:
      baseDir: /var/lib/coding-automator/issues
      key: ${in.repo}#${in.issueId}
workflow:
  issue-pr:
    on:
      - issue:open
    use: codex
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the issue, push a branch, and open a pull request.
  issue-reset:
    on:
      - issue:command:reset
      - issue:close
    use: codex-reset
    prompt: Reset the reusable issue workspace for ${in.repo}#${in.issueId}.
```

The reusable workspace directory name is derived directly from the rendered key after path-safe escaping, for example `acme/demo#7` becomes `acme_demo#7`.

Use keyed workspaces when one issue needs follow-up runs against the same checkout or agent thread. For simple one-shot issue-to-PR automation, the non-keyed example above is easier to operate.

## Security

Running a coding agent directly on the host is a high-trust setup. The agent can potentially read host files, use network access, modify local checkouts, and use any credentials available to the service process.

In the worst case, a misconfigured or compromised agent can run destructive commands against the host and even delete large parts of the system.

If you do not want the agent to run directly on the host, prefer isolating it in Docker or another sandbox. A simple stateless Docker executor can run with no workspace allocation:

```yaml
workspace:
  enabled: false
  baseDir: /var/lib/coding-automator/workspaces
  cleanupAfterRun: false
executors:
  codex-docker:
    run: docker run --rm -e GH_TOKEN -e OPENAI_API_KEY ghcr.io/example/codex:latest codex exec ${prompt}
    workspace: false
workflow:
  issue-pr:
    on:
      - issue:open
    use: codex-docker
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the issue and open a pull request.
```

This keeps the executor off the host filesystem because no workspace is mounted. If your agent needs a checkout or persistent state, mount only the specific directories you intend to expose, or run the agent inside a stronger sandbox such as a dedicated VM.

If the agent does need a working directory, you can still keep the execution inside Docker and mount only the selected workspace path:

```yaml
workspace:
  enabled: true
  baseDir: /var/lib/coding-automator/workspaces
  cleanupAfterRun: false
executors:
  codex-docker-workspace:
    run: docker run --rm -e GH_TOKEN -e OPENAI_API_KEY -v ${workspace}:/workspace -w /workspace ghcr.io/example/codex:latest codex exec ${prompt}
workflow:
  issue-pr:
    on:
      - issue:open
    use: codex-docker-workspace
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the issue and open a pull request.
```

This still exposes the mounted workspace contents to the container, but avoids giving the agent unrestricted access to the whole host filesystem.

If you want to reuse Codex sessions across container runs, mounting the workspace alone is not enough. You also need to persist the Codex home directory, because session metadata is typically stored under `.codex/`.

```yaml
workspace:
  enabled: true
  baseDir: /var/lib/coding-automator/workspaces
  cleanupAfterRun: false
executors:
  codex-docker-reuse:
    run: docker run --rm -e GH_TOKEN -e OPENAI_API_KEY -v ${workspace}:/workspace -v /var/lib/coding-automator/codex-home:/root/.codex -w /workspace ghcr.io/example/codex:latest codex exec ${prompt}
workflow:
  issue-pr:
    on:
      - issue:open
    use: codex-docker-reuse
    prompt: Check issue ${in.issueId} in ${in.repo}. Implement the issue and open a pull request.
```

Without that extra `.codex/` mount, the container may lose its session state when it exits, so session resume features will not work reliably.

## Event Providers

- The current production provider is the GitHub App provider configured under `gh`.
- Providers own their inbound route, request parsing, auth, trigger naming, and provider-specific config.
- The shared runtime owns workflow matching, executor launch, persistent tracking, and restart recovery.
- The YAML contract already preserves additional top-level provider sections so new event sources can be added without changing the core workflow model.
- The current roadmap includes support for more event sources on top of the same provider contract.

## Optional Redelivery Polling

`gh.redelivery` is provider-owned and defaults to `false`. When enabled, the service schedules app-managed GitHub App webhook delivery scans, retries unresolved failed delivery GUIDs once per GUID, and caps each scan at `maxPerRun` redelivery requests. The first automatic scan starts after `intervalSeconds` elapses, not immediately at process boot. On GitHub.com, only deliveries from the last 3 days are eligible for redelivery.

```yaml
gh:
  ...
  redelivery:
    intervalSeconds: 300
    maxPerRun: 20
```

The redelivery service stores its checkpoint next to the tracked run artifacts under `tracking.stateFile`, and app shutdown now cancels pending scheduled waits, logs any in-flight app-managed jobs it is waiting on, and logs a settle marker for each one as it completes. During CLI shutdown drain, detached workflow runs are also printed by name and log a settle line as they leave the active set.

## Configuration Notes

- Workflow prompts may use `${in.*}` variables.
- `workflow.<name>.prompt` may also use `${file:path}` to inline prompt text from another file.
- Top-level prompt include paths resolve relative to the YAML config file, and nested prompt includes resolve relative to the including file.
- Prompt files are expanded at config load, then the resulting prompt renders `${in.*}` variables when a workflow runs.
- Executor commands may use `${configDir}`, `${prompt}`, `${workspace}`, `${workspaceKey}`, and `${env.<NAME>}`.
- `executors.<name>.workspace` is optional:
  - omit it to inherit `workspace.enabled` and `workspace.baseDir`
  - set `false` to disable workspace allocation for that executor
  - set `true` to force workspace allocation with `workspace.baseDir`
  - set a string to force workspace allocation and use that string as the parent workspace directory
  - set a mapping with `baseDir` and/or `key` to configure reusable keyed workspaces
- `executors.<name>.workspace.key` renders from workflow input such as `${in.repo}#${in.issueId}`.
- Runs that render the same `workspace.key` are serialized across executors and reuse one stable workspace directory.
- Relative `workspace.baseDir`, string `executors.<name>.workspace`, and `executors.<name>.workspace.baseDir` values resolve from the YAML file location, so `${workspace}` is an absolute path when allocation is enabled.
- `${configDir}` resolves to the directory containing the loaded YAML config file.
- `${env.<NAME>}` resolves from the final executor environment after merge order `base process env -> executor env -> trigger env`, plus injected values such as `GH_TOKEN` when present.
- `${env.NODE_BIN}` resolves to the current Node.js binary path from `process.execPath`, even if it is not otherwise present in the child process environment.
- `${configDir}`, `${prompt}`, `${workspace}`, `${workspaceKey}`, and `${env.*}` values are shell-escaped before command execution.
- The current GitHub provider keeps `in` intentionally small. It emits `event`, `user`, `repo`, and when relevant `issueId`, `prId`, `content`, `prReview`, and `command`.
- For PR-scoped workflows, the GitHub provider populates `issueId` from GitHub's `closingIssuesReferences` result when GitHub resolves a linked issue for that PR.
- The current GitHub provider emits `issue:at` and `pr:at` when the bot handle appears in issue or PR comments.
- Inline `pull_request_review_comment` deliveries with `comment.pull_request_review_id` are treated as part of the submitted review and do not emit standalone `pr:comment` or `pr:at` triggers.
- `gh.requireMention` defaults to `true`. Set it to `false` if you want `/plan` and `/approve` to work on issues without a leading bot mention.
- Closed issues do not dispatch normal issue-comment or slash-command workflows.
- `gh.ignoreApprovalReview` defaults to `true`. Set it to `false` if approved PR reviews should still trigger `pr:review`.
- The executor launch environment is merged as `base process env -> executor env -> trigger env`.
- The shipped GitHub provider injects `GH_TOKEN` for matched runs so your agent can call GitHub as the app installation.
- When the selected executor resolves to no workspace allocation, `${workspace}` resolves to an empty string.
- When the selected executor has no `workspace.key`, `${workspaceKey}` resolves to an empty string.

## Operations

- Runs are launched as detached background processes.
- `tracking.stateFile` stores non-terminal runs, and `tracking.logFile` stores append-only terminal outcomes.
- Per-run wrapper, PID, result, stdout, and stderr files are stored next to the state file under a derived run-artifacts directory.
- Keyed queued runs persist enough launch state to survive restart, and the next queued keyed run is released when the current owner reaches a terminal state.
- `workspace.cleanupAfterRun` only removes ephemeral per-run workspaces. Reusable keyed workspaces are removed by reset or close workflows.
- Press `Ctrl-C` once to stop accepting new HTTP requests, cancel pending app-managed scheduled waits such as GitHub redelivery, log any in-flight app-managed jobs still being awaited, log a done marker as each one settles, print the detached workflow runs it is still waiting on by name, log a settle line as each tracked workflow run disappears from the active set, and then exit `0` once tracked `queued` or `running` workflows have drained. Press `Ctrl-C` again to exit immediately.
- If `gh.redelivery` is enabled, the GitHub provider registers a background app service that schedules recent GitHub App delivery scans through the built-in app scheduler and requests redelivery for unresolved failures.
- `logging.level: debug` adds inbound request metadata and clipped executor command and stdout previews to runtime logs.
- Executors are command templates only; containerization, sandboxing, and repo checkout strategy stay operator-defined.

## Further Reading

- `AGENTS.md` is the repo table of contents for humans and agents.
- `ARCHITECTURE.md` defines the layer model.
- `docs/product-specs/starter-scope.md` captures the shipped starter scope.
- `docs/design-docs/workflow-config.md` documents the full YAML contract.
- `.github/workflows/check.yml` runs `npm run check` in CI.
