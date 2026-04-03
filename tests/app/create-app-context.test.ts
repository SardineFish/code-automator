import assert from "node:assert/strict";
import test from "node:test";

import { createAppContext } from "../../src/app/create-app-context.js";
import type { AppRuntimeOptions } from "../../src/app/default-app-runtime.js";
import type { AppContextTerminalListeners } from "../../src/types/runtime.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../src/types/tracking.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";

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

test("createAppContext registers completed and error listeners before submit", async () => {
  const subscriptions: Array<{ runId: string; listeners: AppContextTerminalListeners }> = [];
  const runtime = createRuntime(subscriptions);
  const context = createAppContext("/gh-hook", createServiceConfig(), runtime);
  const onCompleted = () => undefined;
  const onError = () => undefined;

  assert.equal(typeof context.on("completed", onCompleted), "function");
  assert.equal(typeof context.on("error", onError), "function");

  context.trigger("issue:command:plan", {
    in: { event: "issue:command:plan", issueId: "7" }
  });

  const result = await context.submit();

  assert.equal(result.status, "matched");
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0]?.runId, "run-1");
  assert.equal(subscriptions[0]?.listeners.completed[0], onCompleted);
  assert.equal(subscriptions[0]?.listeners.error[0], onError);
});

test("createAppContext unsubscribe removes terminal listeners before submit", async () => {
  const subscriptions: Array<{ runId: string; listeners: AppContextTerminalListeners }> = [];
  const runtime = createRuntime(subscriptions);
  const context = createAppContext("/gh-hook", createServiceConfig(), runtime);
  const unsubscribe = context.on("error", () => undefined);

  unsubscribe();
  context.trigger("issue:command:plan", {
    in: { event: "issue:command:plan", issueId: "7" }
  });

  const result = await context.submit();

  assert.equal(result.status, "matched");
  assert.deepEqual(subscriptions, []);
});

test("createAppContext rejects terminal listeners after submit", async () => {
  const subscriptions: Array<{ runId: string; listeners: AppContextTerminalListeners }> = [];
  const runtime = createRuntime(subscriptions);
  const context = createAppContext("/gh-hook", createServiceConfig(), runtime);

  context.trigger("issue:command:plan", {
    in: { event: "issue:command:plan", issueId: "7" }
  });
  await context.submit();

  assert.throws(
    () => context.on("error", () => undefined),
    /Cannot register terminal listeners after submit\(\)\./
  );
});

function createRuntime(
  subscriptions: Array<{ runId: string; listeners: AppContextTerminalListeners }>
): AppRuntimeOptions {
  return {
    processRunner: {
      async run() {
        throw new Error("should not run");
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
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        return createQueuedRunRecord("run-1");
      },
      subscribeTerminalEvents(runId, listeners) {
        subscriptions.push({
          runId,
          listeners: {
            completed: [...listeners.completed],
            error: [...listeners.error]
          }
        });
        return () => undefined;
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async getActiveRunCount() {
        return 0;
      },
      async markRunning() {
        return {} as never;
      },
      async markTerminal() {
        return null;
      },
      async reconcileActiveRuns() {}
    },
    logSink: createNoOpLogSink(),
    baseEnv: {},
    reconcileIntervalMs: 0
  };
}
