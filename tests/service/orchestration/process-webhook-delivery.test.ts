import assert from "node:assert/strict";
import test from "node:test";

import { processWebhookDelivery } from "../../../src/service/orchestration/process-webhook-delivery.js";
import {
  issueCommentPayload,
  issueOpenedPayload,
  reviewPayload
} from "../../fixtures/github-webhooks.js";
import { createServiceConfig } from "../../fixtures/service-config.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../../src/types/tracking.js";

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
    deliveryId: "delivery-1",
    eventName: "issue_comment",
    workflowName: "issue-plan",
    matchedTrigger: "issue:comment",
    executorName: "codex",
    repoFullName: "acme/demo",
    actorLogin: "octocat",
    installationId: 42,
    workspacePath: "",
    artifacts
  };
}

test("processWebhookDelivery launches tracked runs for the documented workflows", async () => {
  const config = createServiceConfig();
  const commands: string[] = [];
  const startedRuns: string[] = [];
  const trackers: string[] = [];
  let runCount = 0;
  const workspaceRepo = {
    async createRunWorkspace() {
      return "";
    },
    async removeWorkspace() {}
  };
  const processRunner = {
    async run() {
      throw new Error("should not be called");
    },
    async startDetached(command: string) {
      commands.push(command);
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
  };
  const workflowTracker = {
    async initialize() {},
    async createQueuedRun(context: { workflowName: string }) {
      trackers.push(`queued:${context.workflowName}`);
      return createQueuedRunRecord(`run-${trackers.length}`);
    },
    async updateQueuedRun() {
      return {} as never;
    },
    async markRunning(runId: string, details: { command: string }) {
      trackers.push(`running:${runId}`);
      startedRuns.push(details.command);
      return {} as never;
    },
    async markTerminal() {
      throw new Error("should not be called");
    },
    async reconcileActiveRuns() {}
  };
  const installationTokenProvider = {
    async createInstallationToken() {
      return "installation-token";
    }
  };

  const scenarios = [
    {
      name: "issue-plan",
      eventName: "issues",
      payload: issueOpenedPayload(),
      expectedWorkflow: "issue-plan",
      expectedExecutor: "codex",
      expectedCommand: "codex exec 'Plan subject 7 in acme/demo'"
    },
    {
      name: "issue-implement",
      eventName: "issue_comment",
      payload: issueCommentPayload("@github-agent-orchestrator /approve"),
      expectedWorkflow: "issue-implement",
      expectedExecutor: "claude",
      expectedCommand: "claude exec 'Implement subject 7 in acme/demo'"
    },
    {
      name: "issue-at",
      eventName: "issue_comment",
      payload: issueCommentPayload("@github-agent-orchestrator please summarize"),
      expectedWorkflow: "issue-at",
      expectedExecutor: "codex",
      expectedCommand: "codex exec 'Handle please summarize on acme/demo'"
    },
    {
      name: "pr-review",
      eventName: "pull_request_review",
      payload: reviewPayload("", "changes_requested"),
      expectedWorkflow: "pr-review",
      expectedExecutor: "codex",
      expectedCommand: "codex exec 'Review PR 8 in acme/demo: changes_requested'"
    }
  ];

  for (const scenario of scenarios) {
    const result = await processWebhookDelivery({
      config,
      botHandle: "github-agent-orchestrator",
      clientId: "client-id",
      eventName: scenario.eventName,
      payload: scenario.payload,
      processRunner,
      workspaceRepo,
      installationTokenProvider,
      workflowTracker
    });

    assert.equal(result.status, "matched", scenario.name);
    assert.equal(result.reason, "queued", scenario.name);
    assert.equal(result.workflowName, scenario.expectedWorkflow, scenario.name);
    assert.equal(result.executorName, scenario.expectedExecutor, scenario.name);
    assert.equal(result.command, undefined, scenario.name);
    assert.equal(result.executionStatus, "queued", scenario.name);
    assert.ok(result.runId, scenario.name);
    assert.equal(result.pid, undefined, scenario.name);
  }

  await waitForCondition(() => startedRuns.length === scenarios.length);
  assert.deepEqual(commands, scenarios.map((scenario) => scenario.expectedCommand));
  assert.deepEqual(startedRuns, scenarios.map((scenario) => scenario.expectedCommand));
});

test("processWebhookDelivery persists launch failures", async () => {
  const trackedErrors: string[] = [];

  const result = await processWebhookDelivery({
    config: createServiceConfig(),
    botHandle: "github-agent-orchestrator",
    clientId: "client-id",
    eventName: "issue_comment",
    payload: issueCommentPayload("@github-agent-orchestrator /plan"),
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached() {
        throw new Error("spawn failed");
      },
      isProcessRunning() {
        return false;
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
    installationTokenProvider: {
      async createInstallationToken() {
        return "installation-token";
      }
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        return createQueuedRunRecord("run-1");
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async markRunning() {
        throw new Error("should not be called");
      },
      async markTerminal(runId: string, _status: string, details: { errorMessage?: string }) {
        trackedErrors.push(`${runId}:${details.errorMessage}`);
        return null;
      },
      async reconcileActiveRuns() {}
    }
  });

  assert.equal(result.status, "matched");
  assert.equal(result.reason, "queued");
  await waitForCondition(() => trackedErrors.length === 1);
  assert.deepEqual(trackedErrors, ["run-1:spawn failed"]);
});

test("processWebhookDelivery keeps queued tracking when markRunning fails after launch", async () => {
  const trackedErrors: string[] = [];

  const result = await processWebhookDelivery({
    config: createServiceConfig(),
    botHandle: "github-agent-orchestrator",
    clientId: "client-id",
    eventName: "issue_comment",
    payload: issueCommentPayload("@github-agent-orchestrator /plan"),
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached() {
        return {
          pid: 4242,
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
    installationTokenProvider: {
      async createInstallationToken() {
        return "installation-token";
      }
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        return createQueuedRunRecord("run-2");
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async markRunning() {
        throw new Error("state write failed");
      },
      async markTerminal(runId: string, _status: string, details: { errorMessage?: string }) {
        trackedErrors.push(`${runId}:${details.errorMessage}`);
        return null;
      },
      async reconcileActiveRuns() {}
    }
  });

  assert.equal(result.status, "matched");
  assert.equal(result.reason, "queued");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(trackedErrors, []);
});

test("processWebhookDelivery ignores unmatched deliveries", async () => {
  const result = await processWebhookDelivery({
    config: createServiceConfig(),
    botHandle: "github-agent-orchestrator",
    clientId: "client-id",
    eventName: "issue_comment",
    payload: issueCommentPayload("plain comment without mention"),
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached() {
        throw new Error("should not run");
      },
      isProcessRunning() {
        return false;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not run");
      },
      async removeWorkspace() {}
    },
    installationTokenProvider: {
      async createInstallationToken() {
        throw new Error("should not run");
      }
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        throw new Error("should not run");
      },
      async updateQueuedRun() {
        throw new Error("should not run");
      },
      async markRunning() {
        throw new Error("should not run");
      },
      async markTerminal() {
        throw new Error("should not run");
      },
      async reconcileActiveRuns() {}
    }
  });

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "unsupported_event");
});

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
