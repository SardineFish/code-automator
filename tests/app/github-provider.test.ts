import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

import { App } from "../../src/app/app.js";
import { githubProvider } from "../../src/app/providers/github-provider.js";
import {
  issueCommentPayload,
  issueOpenedPayload,
  reviewPayload
} from "../fixtures/github-webhooks.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../src/types/tracking.js";

function createQueuedRunRecord(runId: string): ActiveWorkflowRunRecord {
  const artifacts: WorkflowRunArtifacts = {
    runDir: `/tmp/${runId}`,
    wrapperScriptPath: `/tmp/${runId}/run.sh`,
    pidFilePath: `/tmp/${runId}/wrapper.pid`,
    resultFilePath: `/tmp/${runId}/result.json`,
    stdoutPath: `/tmp/${runId}/stdout.log`,
    stderrPath: `/tmp/${runId}/stderr.log`
  };

  return {
    runId,
    status: "queued",
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    source: "/gh-hook",
    workflowName: "issue-plan",
    matchedTrigger: "issue:open",
    executorName: "codex",
    workspacePath: "",
    artifacts
  };
}

test("GitHub provider rejects invalid signatures", async () => {
  const { server, url } = await startGitHubApp();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": "sha256=bad"
    },
    body: JSON.stringify(issueCommentPayload("@github-agent-orchestrator /plan"))
  });

  assert.equal(response.status, 401);
  server.close();
  await once(server, "close");
});

test("GitHub provider ignores whitelist rejections without launching workflows", async () => {
  const payload = issueCommentPayload("@github-agent-orchestrator /plan", { senderLogin: "intruder" });
  const { server, started, url } = await startGitHubApp();

  const response = await signedRequest(url, payload, "issue_comment");

  assert.equal(response.status, 202);
  assert.deepEqual(started, []);
  server.close();
  await once(server, "close");
});

test("GitHub provider routes the documented workflows through the provider app", async () => {
  const { commands, envs, server, started, url } = await startGitHubApp();
  const scenarios = [
    {
      name: "issue-plan",
      eventName: "issues",
      payload: issueOpenedPayload(),
      expectedCommand: "codex exec 'Plan subject 7 in acme/demo'"
    },
    {
      name: "issue-implement",
      eventName: "issue_comment",
      payload: issueCommentPayload("@github-agent-orchestrator /approve"),
      expectedCommand: "claude exec 'Implement subject 7 in acme/demo'"
    },
    {
      name: "issue-at",
      eventName: "issue_comment",
      payload: issueCommentPayload("@github-agent-orchestrator please summarize"),
      expectedCommand: "codex exec 'Handle please summarize on acme/demo'"
    },
    {
      name: "pr-review",
      eventName: "pull_request_review",
      payload: reviewPayload("", "changes_requested"),
      expectedCommand: "codex exec 'Review PR 8 in acme/demo: changes_requested'"
    }
  ];

  for (const scenario of scenarios) {
    const response = await signedRequest(url, scenario.payload, scenario.eventName);
    assert.equal(response.status, 202, scenario.name);
  }

  await waitForCondition(() => started.length === scenarios.length);
  assert.deepEqual(commands, scenarios.map((scenario) => scenario.expectedCommand));
  assert.deepEqual(started, scenarios.map((scenario) => scenario.expectedCommand));
  assert.ok(envs.every((env) => env.GITHUB_TOKEN === "installation-token"));
  server.close();
  await once(server, "close");
});

async function startGitHubApp() {
  const config = {
    ...createServiceConfig(),
    server: {
      host: "127.0.0.1",
      port: 0
    }
  };
  const github = config.gh;

  if (!github) {
    throw new Error("Missing test GitHub config.");
  }
  const commands: string[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const started: string[] = [];
  let runCount = 0;
  const logSink = createNoOpLogSink();

  const server = await App(config, {
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached(command, options) {
        commands.push(command);
        envs.push(options.env);
        runCount += 1;
        return {
          pid: 1000 + runCount,
          startedAt: "2026-04-02T00:00:00.000Z"
        };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        return "";
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        return createQueuedRunRecord(`run-${runCount + 1}`);
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async markRunning(_runId: string, details: { command: string }) {
        started.push(details.command);
        return {} as never;
      },
      async markTerminal() {
        throw new Error("should not be called");
      },
      async reconcileActiveRuns() {}
    },
    logSink,
    reconcileIntervalMs: 0
  })
    .provider(
      github.url,
      githubProvider(github, {
        webhookSecret: "top-secret",
        installationTokenProvider: {
          async createInstallationToken() {
            return "installation-token";
          }
        },
        logSink
      })
    )
    .listen();

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  return {
    server,
    commands,
    envs,
    started,
    url: `http://127.0.0.1:${address.port}${github.url}`
  };
}

async function signedRequest(url: string, payload: unknown, eventName: string) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", "top-secret").update(body).digest("hex");

  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-hub-signature-256": `sha256=${signature}`
    },
    body
  });
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for background workflow launch.");
}
