import assert from "node:assert/strict";
import test from "node:test";

import {
  createCliShutdownCoordinator,
  FORCED_SIGINT_EXIT_CODE,
  SIGINT_DRAIN_MESSAGE,
  WAITING_FOR_WORKFLOW_RUN_DURING_SHUTDOWN_PREFIX,
  WORKFLOW_RUN_SETTLED_DURING_SHUTDOWN_PREFIX
} from "../../src/app/cli-shutdown.js";
import type { ActiveWorkflowRunRecord } from "../../src/types/tracking.js";

test("createCliShutdownCoordinator drains active work in order on first SIGINT", async () => {
  const events: string[] = [];
  const messages: string[] = [];
  const exitCodes: number[] = [];
  const snapshots = [
    [
      createActiveRun("run-1", "issue-plan", "codex", "acme/demo"),
      createActiveRun("run-2", "pr-review", "claude")
    ],
    [createActiveRun("run-2", "pr-review", "claude")],
    [createActiveRun("run-2", "pr-review", "claude")],
    []
  ];
  const coordinator = createCliShutdownCoordinator({
    app: {
      server: {} as never,
      async shutdown() {
        events.push("shutdown-app");
      }
    },
    workflowTracker: {
      async getActiveRuns() {
        const activeRuns = snapshots.shift() ?? [];
        events.push(`runs:${activeRuns.map((run) => run.runId).join(",")}`);
        return activeRuns;
      }
    },
    sleep: async () => {
      events.push("sleep");
    },
    writeLine(line) {
      messages.push(line);
    },
    exit(code) {
      exitCodes.push(code);
    }
  });

  coordinator.handleSigint();
  await coordinator.waitForShutdown();

  assert.equal(coordinator.getState(), "draining");
  assert.deepEqual(messages, [
    SIGINT_DRAIN_MESSAGE,
    `${WAITING_FOR_WORKFLOW_RUN_DURING_SHUTDOWN_PREFIX} issue-plan via codex for acme/demo (run-1)`,
    `${WAITING_FOR_WORKFLOW_RUN_DURING_SHUTDOWN_PREFIX} pr-review via claude (run-2)`,
    `${WORKFLOW_RUN_SETTLED_DURING_SHUTDOWN_PREFIX} issue-plan via codex for acme/demo (run-1)`,
    `${WORKFLOW_RUN_SETTLED_DURING_SHUTDOWN_PREFIX} pr-review via claude (run-2)`
  ]);
  assert.deepEqual(events, [
    "shutdown-app",
    "runs:run-1,run-2",
    "sleep",
    "runs:run-2",
    "sleep",
    "runs:run-2",
    "sleep",
    "runs:"
  ]);
  assert.deepEqual(exitCodes, [0]);
});

test("createCliShutdownCoordinator forces immediate exit on second SIGINT", async () => {
  const events: string[] = [];
  const exitCodes: number[] = [];
  const release = createDeferred<void>();
  const coordinator = createCliShutdownCoordinator({
    app: {
      server: {} as never,
      async shutdown() {
        events.push("shutdown-app");
        await release.promise;
      }
    },
    workflowTracker: {
      async getActiveRuns() {
        events.push("runs:");
        return [];
      }
    },
    writeLine() {},
    exit(code) {
      exitCodes.push(code);
    }
  });

  coordinator.handleSigint();
  assert.equal(coordinator.getState(), "draining");

  coordinator.handleSigint();
  assert.equal(coordinator.getState(), "forced");
  assert.deepEqual(exitCodes, [FORCED_SIGINT_EXIT_CODE]);

  release.resolve();
  await coordinator.waitForShutdown();

  assert.deepEqual(events, ["shutdown-app", "runs:"]);
  assert.deepEqual(exitCodes, [FORCED_SIGINT_EXIT_CODE]);
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createActiveRun(
  runId: string,
  workflowName: string,
  executorName: string,
  repoFullName?: string
): ActiveWorkflowRunRecord {
  return {
    runId,
    status: "running",
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    workflowName,
    matchedTrigger: "issue:command:plan",
    executorName,
    repoFullName,
    workspacePath: "",
    artifacts: {
      runDir: `/tmp/${runId}`,
      wrapperScriptPath: `/tmp/${runId}/run.sh`,
      pidFilePath: `/tmp/${runId}/wrapper.pid`,
      resultFilePath: `/tmp/${runId}/result.json`,
      stdoutPath: `/tmp/${runId}/stdout.log`,
      stderrPath: `/tmp/${runId}/stderr.log`
    }
  };
}
