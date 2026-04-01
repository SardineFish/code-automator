import assert from "node:assert/strict";
import test from "node:test";

import { processWebhookDelivery } from "../../../src/service/orchestration/process-webhook-delivery.js";
import {
  issueCommentPayload,
  issueOpenedPayload,
  reviewCommentPayload,
  reviewPayload
} from "../../fixtures/github-webhooks.js";
import { createServiceConfig } from "../../fixtures/service-config.js";

test("processWebhookDelivery covers the four documented workflows", async () => {
  const config = createServiceConfig();
  const commands: string[] = [];
  const workspaceRepo = {
    async createRunWorkspace() {
      return "";
    },
    async removeWorkspace() {}
  };
  const processRunner = {
    async run(command: string) {
      commands.push(command);
      return { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false };
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
      eventName: scenario.eventName,
      payload: scenario.payload,
      processRunner,
      workspaceRepo
    });

    assert.equal(result.status, "matched", scenario.name);
    assert.equal(result.workflowName, scenario.expectedWorkflow, scenario.name);
    assert.equal(result.executorName, scenario.expectedExecutor, scenario.name);
    assert.equal(result.command, scenario.expectedCommand, scenario.name);
  }

  assert.deepEqual(commands, scenarios.map((scenario) => scenario.expectedCommand));
});

test("processWebhookDelivery ignores unmatched deliveries", async () => {
  const result = await processWebhookDelivery({
    config: createServiceConfig(),
    eventName: "issue_comment",
    payload: issueCommentPayload("plain comment without mention"),
    processRunner: {
      async run() {
        throw new Error("should not run");
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not run");
      },
      async removeWorkspace() {}
    }
  });

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "unsupported_event");
});
