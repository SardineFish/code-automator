import assert from "node:assert/strict";
import test from "node:test";

import { processTriggerSubmission } from "../../../src/service/orchestration/process-trigger-submission.js";
import { createServiceConfig } from "../../fixtures/service-config.js";
import { createNoOpLogSink } from "../../fixtures/log-sink.js";
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
    source: "/gh-hook",
    workflowName: "issue-plan",
    matchedTrigger: "issue:command:plan",
    executorName: "codex",
    workspacePath: "",
    artifacts
  };
}

test("processTriggerSubmission launches the first matching workflow with matched trigger input and env", async () => {
  const commands: string[] = [];
  const envValues: NodeJS.ProcessEnv[] = [];
  const running: string[] = [];
  const result = await processTriggerSubmission({
    config: createServiceConfig(),
    source: "/gh-hook",
    triggers: [
      {
        name: "issue:command:plan",
        input: { event: "issue:command:plan", issueId: "7", user: "octocat" },
        env: { GH_TOKEN: "token-1", SHARED: "trigger" }
      },
      {
        name: "issue:comment",
        input: { event: "issue:comment", content: "please summarize", user: "octocat" },
        env: { GH_TOKEN: "token-2" }
      }
    ],
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached(command, options) {
        commands.push(command);
        envValues.push(options.env);
        return { pid: 4242, startedAt: "2026-04-02T00:00:00.000Z" };
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
        return createQueuedRunRecord("run-1");
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async markRunning(runId: string, details: { command: string }) {
        running.push(`${runId}:${details.command}`);
        return {} as never;
      },
      async markTerminal() {
        throw new Error("should not be called");
      },
      async reconcileActiveRuns() {}
    },
    logSink: createNoOpLogSink(),
    baseEnv: { BASE: "1" }
  });

  assert.equal(result.status, "matched");
  assert.equal(result.reason, "queued");
  assert.equal(result.workflowName, "issue-plan");
  assert.equal(result.matchedTrigger, "issue:command:plan");
  await waitForCondition(() => running.length === 1);
  assert.deepEqual(commands, ["codex exec 'Plan issue 7'"]);
  assert.equal(envValues[0]?.BASE, "1");
  assert.equal(envValues[0]?.EXECUTOR, "codex");
  assert.equal(envValues[0]?.GH_TOKEN, "token-1");
  assert.equal(envValues[0]?.SHARED, "trigger");
});

test("processTriggerSubmission ignores empty trigger submissions", async () => {
  const result = await processTriggerSubmission({
    config: createServiceConfig(),
    source: "/chat",
    triggers: [],
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
    },
    logSink: createNoOpLogSink()
  });

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "no_triggers_submitted");
});

test("processTriggerSubmission prepares an executor-specific workspace before launch", async () => {
  const config = createServiceConfig();
  config.executors.codex.run = "codex -w ${workspace} exec ${prompt}";
  config.executors.codex.workspace = "/tmp/codex-parent";

  const queuedUpdates: string[] = [];
  const startedCwds: string[] = [];
  const running: string[] = [];
  const result = await processTriggerSubmission({
    config,
    source: "/gh-hook",
    triggers: [
      {
        name: "issue:command:plan",
        input: { event: "issue:command:plan", issueId: "7", user: "octocat" },
        env: {}
      }
    ],
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached(command, options) {
        startedCwds.push(options.cwd);
        running.push(command);
        return { pid: 5151, startedAt: "2026-04-02T00:00:00.000Z" };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace(baseDir) {
        assert.equal(baseDir, "/tmp/codex-parent");
        return "/tmp/codex-parent/run-1";
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        return createQueuedRunRecord("run-2");
      },
      async updateQueuedRun(runId, details) {
        queuedUpdates.push(`${runId}:${details.workspacePath}`);
        return {} as never;
      },
      async markRunning(runId: string, details: { command: string }) {
        running.push(`${runId}:${details.command}`);
        return {} as never;
      },
      async markTerminal() {
        throw new Error("should not be called");
      },
      async reconcileActiveRuns() {}
    },
    logSink: createNoOpLogSink()
  });

  assert.equal(result.status, "matched");
  await waitForCondition(() => running.length === 2);
  assert.deepEqual(queuedUpdates, ["run-2:/tmp/codex-parent/run-1"]);
  assert.deepEqual(startedCwds, ["/tmp/codex-parent/run-1"]);
  assert.equal(running[0], "codex -w '/tmp/codex-parent/run-1' exec 'Plan issue 7'");
  assert.equal(running[1], "run-2:codex -w '/tmp/codex-parent/run-1' exec 'Plan issue 7'");
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
